/* eslint-disable no-console */

'use strict';

var port = process.env.APP_PORT || 3000;
var agentPort = process.env.AGENT_PORT;

// TODOs
// - client: streaming client
// - client: streaming server
// - client: bidi streaming
// - server#sendUnaryResponse
// - server#handleUnary
// - ServerUnaryCall is an EventEmitter

require('../../../../')({
  agentPort: agentPort,
  level: 'warn',
  tracing: {
    enabled: process.env.TRACING_ENABLED === 'true',
    forceTransmissionStartingAt: 1
  }
});

var bodyParser = require('body-parser');
var express = require('express');
var morgan = require('morgan');
var grpc = require('grpc');
var path = require('path');
var app = express();

var STATIC = !!process.env.GRPC_STATIC;
var withMetadata = !!process.env.GRPC_WITH_METADATA;
var PACKAGE_VERSION = process.env.GRPC_PACKAGE_VERSION || '=1.10.1';
var PROTO_PATH = path.join(__dirname, 'protos/test.proto');
var logPrefix = 'GRPC Client (' + process.pid + '):\t';

var client;
var messages;
var makeUnaryCall;
var startServerSideStreaming;
var startClientSideStreaming;
var startBidiStreaming;

switch (PACKAGE_VERSION) {
  case '=1.10.1':
    if (STATIC) {
      runStaticLegacyClient();
    } else {
      runDynamicLegacyClient();
    }
    break;
  case '>=1.17.0':
    if (STATIC) {
      runStaticModernClient();
    } else {
      runDynamicModernClient();
    }
    break;
  default:
    throw new Error('Unsupported API version: ' + PACKAGE_VERSION);
}

/**
 * grpc@1.10.1, static codegen
 */
function runStaticLegacyClient() {
  log('Running static legacy GRPC client.');

  messages = require('./test_pb');
  var services = require('./test_grpc_pb');
  client = new services.TestServiceClient('localhost:50051', grpc.credentials.createInsecure());
  makeUnaryCall = staticUnaryCall;
  startServerSideStreaming = staticServerSideStreaming;
  startClientSideStreaming = staticClientSideStreaming;
  startBidiStreaming = staticBidiStreaming;
}

/**
 * grpc@1.10.1, dynamic codegen
 */
function runDynamicLegacyClient() {
  log('Running dynamic legacy GRPC client.');

  var testProto = grpc.load(PROTO_PATH).instana.node.grpc.test;
  client = new testProto.TestService('localhost:50051', grpc.credentials.createInsecure());
  makeUnaryCall = dynamicUnaryCall;
  startServerSideStreaming = dynamicServerSideStreaming;
  startClientSideStreaming = dynamicClientSideStreaming;
  startBidiStreaming = dynamicBidiStreaming;
}

/**
 * grpc@^1.17.0, static codegen
 */
function runStaticModernClient() {
  log('Running static modern GRPC client.');

  messages = require('./test_pb');
  var services = require('./test_grpc_pb');
  client = new services.TestServiceClient('localhost:50051', grpc.credentials.createInsecure());
  makeUnaryCall = staticUnaryCall;
  startServerSideStreaming = staticServerSideStreaming;
  startClientSideStreaming = staticClientSideStreaming;
  startBidiStreaming = staticBidiStreaming;
}

/**
 * grpc@^1.17.0, dynamic codegen
 */
function runDynamicModernClient() {
  log('Running dynamic modern GRPC client.');

  var protoLoader = require('@grpc/proto-loader');
  var packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  var testProto = grpc.loadPackageDefinition(packageDefinition).instana.node.grpc.test;
  client = new testProto.TestService('localhost:50051', grpc.credentials.createInsecure());
  makeUnaryCall = dynamicUnaryCall;
  startServerSideStreaming = dynamicServerSideStreaming;
  startClientSideStreaming = dynamicClientSideStreaming;
  startBidiStreaming = dynamicBidiStreaming;
}

function staticUnaryCall(cb) {
  var request = new messages.TestRequest();
  request.setParameter('Stan');

  if (withMetadata) {
    client.makeUnaryCall(request, createMetadata(), cb);
  } else {
    client.makeUnaryCall(request, cb);
  }
}

function dynamicUnaryCall(cb) {
  if (withMetadata) {
    client.makeUnaryCall({ parameter: 'Stan' }, createMetadata(), cb);
  } else {
    client.makeUnaryCall({ parameter: 'Stan' }, cb);
  }
}

function staticServerSideStreaming(cb) {
  var replies = [];
  var request = new messages.TestRequest();
  request.setParameter('Stan');
  var call = withMetadata
    ? client.startServerSideStreaming(request, createMetadata())
    : client.startServerSideStreaming(request);
  call.on('data', function(reply) {
    log('Received: ' + reply.getMessage());
    replies.push(reply.getMessage());
  });
  call.on('end', function() {
    cb(null, replies);
  });
}

function dynamicServerSideStreaming(cb) {
  var replies = [];
  var request = { parameter: 'Stan' };
  var call = withMetadata
    ? client.startServerSideStreaming(request, createMetadata())
    : client.startServerSideStreaming(request);

  call.on('data', function(reply) {
    log('Received: ' + reply.message);
    replies.push(reply.message);
  });
  call.on('end', function() {
    cb(null, replies);
  });
}

function staticClientSideStreaming(cb) {
  var call = withMetadata ? client.startClientSideStreaming(createMetadata(), cb) : client.startClientSideStreaming(cb);
  var request = new messages.TestRequest();
  request.setParameter('first');
  call.write(request);
  setTimeout(function() {
    request = new messages.TestRequest();
    request.setParameter('second');
    call.write(request);
    setTimeout(function() {
      request = new messages.TestRequest();
      request.setParameter('third');
      call.write(request);
      setTimeout(function() {
        call.end();
      }, 50);
    }, 50);
  }, 50);
}

function dynamicClientSideStreaming(cb) {
  var call = withMetadata ? client.startClientSideStreaming(createMetadata(), cb) : client.startClientSideStreaming(cb);
  call.write({ parameter: 'first' });
  setTimeout(function() {
    call.write({ parameter: 'second' });
    setTimeout(function() {
      call.write({ parameter: 'third' });
      setTimeout(function() {
        call.end();
      }, 50);
    }, 50);
  }, 50);
}

function staticBidiStreaming(cb) {
  var replies = [];
  var call = withMetadata ? client.startBidiStreaming(createMetadata()) : client.startBidiStreaming();
  call.on('data', function(reply) {
    log('Received: ' + reply.getMessage());
    replies.push(reply.getMessage());
    if (reply.getMessage() === 'STOP') {
      call.end();
    }
  });
  call.on('end', function() {
    cb(null, replies);
  });

  var request = new messages.TestRequest();
  request.setParameter('first');
  call.write(request);
  setTimeout(function() {
    request = new messages.TestRequest();
    request.setParameter('second');
    call.write(request);
    setTimeout(function() {
      request = new messages.TestRequest();
      request.setParameter('third');
      call.write(request);
    }, 50);
  }, 50);
}

function dynamicBidiStreaming(cb) {
  var replies = [];
  var call = withMetadata ? client.startBidiStreaming(createMetadata()) : client.startBidiStreaming();
  call.on('data', function(reply) {
    log('Received: ' + reply.message);
    replies.push(reply.message);
    if (reply.message === 'STOP') {
      call.end();
    }
  });
  call.on('end', function() {
    cb(null, replies);
  });

  call.write({ parameter: 'first' });
  setTimeout(function() {
    call.write({ parameter: 'second' });
    setTimeout(function() {
      call.write({ parameter: 'third' });
    }, 50);
  }, 50);
}

function createMetadata() {
  var metadata = new grpc.Metadata();
  metadata.add('meta', 'data');
  return metadata;
}

if (process.env.WITH_STDOUT) {
  app.use(morgan(logPrefix + ':method :url :status'));
}

app.use(bodyParser.json());

app.get('/', function(req, res) {
  res.send('OK');
});

app.post('/unary', function(req, res) {
  makeUnaryCall(function(err, reply) {
    if (err) {
      console.error(err);
      return res.status(500).send(err);
    }
    var message = typeof reply.getMessage === 'function' ? reply.getMessage() : reply.message;
    return res.send({ reply: message });
  });
});

app.post('/server-stream', function(req, res) {
  startServerSideStreaming(function(err, replyMessages) {
    if (err) {
      console.error(err);
      return res.status(500).send(err);
    }
    console.log('[SERVER SIDE STREAM]: Got', replyMessages);
    return res.send({ replies: replyMessages });
  });
});

app.post('/client-stream', function(req, res) {
  startClientSideStreaming(function(err, reply) {
    if (err) {
      console.error(err);
      return res.status(500).send(err);
    }
    console.log('[CLIENT SIDE STREAM]: Got', reply);
    var message = typeof reply.getMessage === 'function' ? reply.getMessage() : reply.message;
    return res.send({ reply: message });
  });
});

app.post('/bidi-stream', function(req, res) {
  startBidiStreaming(function(err, replyMessages) {
    if (err) {
      console.error(err);
      return res.status(500).send(err);
    }
    console.log('[BIDI STREAM]: Got', replyMessages);
    return res.send({ replies: replyMessages });
  });
});

app.post('/shutdown', function(req, res) {
  client.close();
  return res.send('Good bye :)');
});

app.listen(port, function() {
  log('Listening on port: ' + port);
});

function log() {
  var args = Array.prototype.slice.call(arguments);
  args[0] = logPrefix + args[0];
  console.log.apply(console, args);
}
