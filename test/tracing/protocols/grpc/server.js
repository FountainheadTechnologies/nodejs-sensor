/* eslint-disable no-console */

'use strict';

var agentPort = process.env.AGENT_PORT;

require('../../../../')({
  agentPort: agentPort,
  level: 'warn',
  tracing: {
    enabled: process.env.TRACING_ENABLED === 'true',
    forceTransmissionStartingAt: 1
  }
});

var path = require('path');

var STATIC = !!process.env.GRPC_STATIC;
var PACKAGE_VERSION = process.env.GRPC_PACKAGE_VERSION || '=1.10.1';
var PROTO_PATH = path.join(__dirname, 'protos/test.proto');

var messages;
var server;

var dynamicServerDef = {
  makeUnaryCall: dynamicUnaryCall,
  startServerSideStreaming: dynamicServerSideStreaming,
  startClientSideStreaming: dynamicClientSideStreaming,
  startBidiStreaming: dynamicBidiStreaming
};

var staticServerDef = {
  makeUnaryCall: staticUnaryCall,
  startServerSideStreaming: staticServerSideStreaming,
  startClientSideStreaming: staticClientSideStreaming,
  startBidiStreaming: staticBidiStreaming
};

switch (PACKAGE_VERSION) {
  case '=1.10.1':
    if (STATIC) {
      runStaticLegacyServer();
    } else {
      runDynamicLegacyServer();
    }
    break;
  case '>=1.17.0':
    if (STATIC) {
      runStaticModernServer();
    } else {
      runDynamicModernServer();
    }
    break;
  default:
    throw new Error('Unsupported API version: ' + PACKAGE_VERSION);
}

/**
 * grpc@1.10.1, dynamic codegen
 */
function runDynamicLegacyServer() {
  log('Running dynamic legacy GRPC server.');

  var grpc = require('grpc');
  var testProto = grpc.load(PROTO_PATH).instana.node.grpc.test;

  function main() {
    server = new grpc.Server();
    server.addService(testProto.TestService.service, dynamicServerDef);
    server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
    server.start();
  }

  main();
}

/**
 * grpc@1.10.1, static codegen
 */
function runStaticLegacyServer() {
  log('Running static legacy GRPC server.');

  messages = require('./test_pb');
  var services = require('./test_grpc_pb');

  var grpc = require('grpc');

  function main() {
    server = new grpc.Server();
    server.addService(services.TestServiceService, staticServerDef);
    server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
    server.start();
  }

  main();
}

/**
 * grpc@^1.17.0, dynamic codegen
 */
function runDynamicModernServer() {
  log('Running dynamic modern GRPC server.');

  var grpc = require('grpc');
  var protoLoader = require('@grpc/proto-loader');
  var packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  var testProto = grpc.loadPackageDefinition(packageDefinition).instana.node.grpc.test;

  function main() {
    server = new grpc.Server();
    server.addService(testProto.TestService.service, dynamicServerDef);
    server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
    server.start();
  }

  main();
}

/**
 * grpc@^1.17.0, static codegen
 */
function runStaticModernServer() {
  log('Running static modern GRPC server.');

  messages = require('./test_pb');
  var services = require('./test_grpc_pb');

  var grpc = require('grpc');

  function main() {
    server = new grpc.Server();
    server.addService(services.TestServiceService, staticServerDef);
    server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
    server.start();
  }

  main();
}

function dynamicUnaryCall(call, callback) {
  callback(null, received(call.request.parameter));
}

function staticUnaryCall(call, callback) {
  var reply = new messages.TestReply();
  reply.setMessage('Received ' + call.request.getParameter());
  callback(null, reply);
}

function dynamicServerSideStreaming(call) {
  log('[SERVER SIDE STREAMING] Received: ', call.request);
  call.write(received(call.request.parameter));
  call.write(response('streaming'));
  call.write(response('more'));
  call.write(response('data'));
  call.end();
}

function staticServerSideStreaming(call) {
  log('[SERVER SIDE STREAMING] Received: ', call.request.getParameter());
  var reply = new messages.TestReply();
  reply.setMessage('Received ' + call.request.getParameter());
  call.write(reply);
  reply = new messages.TestReply();
  reply.setMessage('streaming');
  call.write(reply);
  reply = new messages.TestReply();
  reply.setMessage('more');
  call.write(reply);
  reply = new messages.TestReply();
  reply.setMessage('data');
  call.write(reply);
  call.end();
}

function dynamicClientSideStreaming(call, callback) {
  var requests = [];
  call.on('data', function(request) {
    log('[CLIENT SIDE STREAMING] Received: ', request);
    requests.push(request);
  });
  call.on('end', function() {
    log('[CLIENT SIDE STREAMING] END');
    var responseMessage = requests
      .map(function(r) {
        return r.parameter;
      })
      .join('; ');
    callback(null, response(responseMessage));
  });
}

function staticClientSideStreaming(call, callback) {
  var requests = [];
  call.on('data', function(request) {
    log('[CLIENT SIDE STREAMING] Received: ', request.getParameter());
    requests.push(request);
  });
  call.on('end', function() {
    log('[CLIENT SIDE STREAMING] END');
    var responseMessage = requests
      .map(function(r) {
        return r.getParameter();
      })
      .join('; ');
    var reply = new messages.TestReply();
    reply.setMessage(responseMessage);
    callback(null, reply);
  });
}

function dynamicBidiStreaming(call) {
  call.on('data', function(request) {
    log('[BIDI STREAMING] Received: ', request);
    call.write(received(request.parameter));
  });
  call.on('end', function() {
    log('[BIDI STREAMING] END');
    call.end();
  });
}

function staticBidiStreaming(call) {
  var receivedCounter = 0;
  call.on('data', function(request) {
    receivedCounter++;
    log('[BIDI STREAMING] Received: ', request.getParameter());
    var reply = new messages.TestReply();
    reply.setMessage('Received: ' + request.getParameter());
    call.write(reply);
    if (receivedCounter >= 3) {
      var stopReply = new messages.TestReply();
      stopReply.setMessage('STOP');
      call.write(stopReply);
    }
  });
  call.on('end', function() {
    log('[BIDI STREAMING] END');
    call.end();
  });
}

function received(s) {
  return response('Received ' + s);
}

function response(message) {
  return { message: message };
}

function log() {
  var args = Array.prototype.slice.call(arguments);
  args[0] = 'GRPC Server (' + process.pid + '):\t' + args[0];
  console.log.apply(console, args);
}
