'use strict';

var shimmer = require('shimmer');

var Metadata;

var requireHook = require('../../../util/requireHook');
var tracingConstants = require('../../constants');
var tracingUtil = require('../../tracingUtil');
var cls = require('../../cls');

var isActive = false;

exports.init = function() {
  requireHook.onModuleLoad('grpc', instrumentGrpc);
  // requireHook.onFileLoad(/\/grpc\/src\/server\.js/, instrumentServer);
  requireHook.onFileLoad(/\/grpc\/src\/client\.js/, instrumentClient);
};

function instrumentGrpc(grpc) {
  Metadata = grpc.Metadata;
  //   if (typeof grpc.loadPackageDefinition === 'function') {
  //     instrumentLoadPackageDefinition(grpc, 'loadPackageDefinition');
  //   } else if (typeof grpc.load === 'function') {
  //     instrumentLoadPackageDefinition(grpc, 'load');
  //   } else {
  //     logger.warn('Unsupported version of grpc package detected, GRPC calls will not be instrumented');
  //     return;
  //   }
}

// function instrumentLoadPackageDefinition(grpc, loadFunctionName) {
//   console.log('shimming grpc#load(PackageDefinition)', loadFunctionName);
//   shimmer.wrap(grpc, loadFunctionName, shimLoadPackageDefinition);
// }

// function shimLoadPackageDefinition(originalFunction) {
//   return function() {
//     var result = originalFunction.apply(this, arguments);
//     return result;
//   };
// }

// function instrumentServer(serverModule) {}

function instrumentClient(clientModule) {
  // One would think that doing
  // shimmer.wrap(clientModule.Client.prototype, 'makeUnaryRequest', shimMakeUnaryRequest) etc.
  // might be a convenient way to hook into the GRPC client, but the client stubs are created in such a way via lodash
  // that functions like Client.prototype.makeUnaryRequest is not called on the Client object, thus shimming it (that
  // is, replacing it with a wrapper on Client.prototype is ineffective.
  shimmer.wrap(clientModule, 'makeClientConstructor', shimMakeClientConstructor);
}

function shimMakeClientConstructor(originalFunction) {
  return function(methods) {
    var ServiceClient = originalFunction.apply(this, arguments);
    Object.keys(methods).forEach(function(name) {
      var method = methods[name];
      var rpcPath = method.path;
      var shimFn = shimClientMethod.bind(null, rpcPath);
      shimmer.wrap(ServiceClient.prototype, name, shimFn);
      // the method is usually available under two identifiers, `name` (starting with a lower case letter) and
      // `originalName` (beginning with an upper case letter). We need to shim both identifiers.
      if (method.originalName) {
        shimmer.wrap(ServiceClient.prototype, method.originalName, shimFn);
      }
    });
    return ServiceClient;
  };
}

function shimClientMethod(rpcPath, originalFunction) {
  return function() {
    var parentSpan = cls.getCurrentSpan();
    var isTracing = isActive && cls.isTracing() && parentSpan && cls.isEntrySpan(parentSpan);
    var isSuppressed = cls.tracingLevel() === '0';
    if (isTracing || isSuppressed) {
      var originalArgs = new Array(arguments.length);
      for (var i = 0; i < arguments.length; i++) {
        originalArgs[i] = arguments[i];
      }

      if (isTracing) {
        return instrumentedClientMethod(this, originalFunction, originalArgs, rpcPath);
      } else {
        // suppressed
        // TODO Also test this branch!
        modifyArgs(originalArgs); // add x-instana-l: 0 to metadata
        return originalFunction.apply(this, originalArgs);
      }
    }
    return originalFunction.apply(this, arguments);
  };
}

function instrumentedClientMethod(ctx, originalFunction, originalArgs, rpcPath) {
  return cls.ns.runAndReturn(function() {
    var span = cls.startSpan('rpc-client', cls.EXIT);
    span.ts = Date.now();
    span.stack = tracingUtil.getStackTrace(instrumentedClientMethod);
    span.data = {
      rpc: {
        call: dropLeadingSlash(rpcPath), // 'helloworld.Greeter/SayHello',
        flavor: 'grpc'
      }
    };

    modifyArgs(originalArgs, span);

    return originalFunction.apply(ctx, originalArgs);
  });
}

/**
 * Must only be called if we are actively tracing (there is an active entry parent) or tracing is * explicitly
 * suppressed (incoming call had x-instana-l = '0'). In the former case we expect the GRPC span in the making to be
 * passed. The GRPC result callback is wrapped and we add all three x-instana tracing headers. In the latter case (span
 * is null or undefined), we just add x-instana-l: '0'.
 */
function modifyArgs(originalArgs, span) {
  // find callback and metadata in original arguments
  var callbackIndex = -1;
  var metadataIndex = -1;
  for (var i = originalArgs.length - 1; i >= 0; i--) {
    if (originalArgs[i] && originalArgs[i].constructor && originalArgs[i].constructor.name === 'Metadata') {
      metadataIndex = i;
    }
    if (typeof originalArgs[i] === 'function') {
      callbackIndex = i;
    }
  }

  if (span && callbackIndex >= 0) {
    // we are tracing, so we wrap the original callback to get notified when the GRPC call finishes
    var originalCallback = originalArgs[callbackIndex];
    originalArgs[callbackIndex] = cls.ns.bind(function(err) {
      span.d = Date.now() - span.ts;
      span.transmit();
      if (err) {
        // TODO Mark erroneous
      }
      originalCallback.apply(this, arguments);
    });
  }

  var metadata;
  if (metadataIndex >= 0) {
    metadata = originalArgs[metadataIndex];
  } else if (Metadata && callbackIndex >= 0) {
    // insert new metadata object as second to last argument, before the callback
    metadata = new Metadata();
    originalArgs.splice(callbackIndex, 0, metadata);
  } else if (Metadata) {
    // append new metadata object as last argument
    metadata = new Metadata();
    originalArgs.push(metadata);
  }

  if (span) {
    // we are actively tracing, so we add x-instana-t, x-instana-s and set x-instana-l: 1
    metadata.add(tracingConstants.spanIdHeaderName, span.s);
    metadata.add(tracingConstants.traceIdHeaderName, span.t);
    metadata.add(tracingConstants.traceLevelHeaderName, '1');
  } else {
    // tracing is suppressed, so we only set x-instana-l: 0
    metadata.add(tracingConstants.traceLevelHeaderName, '0');
  }
}

function dropLeadingSlash(rpcPath) {
  if (typeof rpcPath === 'string') {
    if (rpcPath[0] === '/') {
      return rpcPath.substr(1);
    }
    return rpcPath;
  }
  return 'unknown';
}

exports.activate = function() {
  isActive = true;
};

exports.deactivate = function() {
  isActive = false;
};
