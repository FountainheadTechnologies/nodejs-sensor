/* eslint-disable no-console */

'use strict';

var port = process.env.APP_PORT || 3000;
var agentPort = process.env.AGENT_PORT;

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
var path = require('path');
var app = express();

var STATIC = !!process.env.GRPC_STATIC;
var PACKAGE_VERSION = process.env.GRPC_PACKAGE_VERSION || '=1.10.1';
var PROTO_PATH = path.join(__dirname, 'protos/helloworld.proto');
var logPrefix = 'GRPC Client (' + process.pid + '):\t';

var client;
var sendMessage;

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

  var messages = require('./helloworld_pb');
  var services = require('./helloworld_grpc_pb');

  var grpc = require('grpc');

  sendMessage = function(cb) {
    client = new services.GreeterClient('localhost:50051', grpc.credentials.createInsecure());
    var request = new messages.HelloRequest();
    request.setName('Stan');
    client.sayHello(request, cb);
  };
}

/**
 * grpc@1.10.1, dynamic codegen
 */
function runDynamicLegacyClient() {
  log('Running dynamic legacy GRPC client.');

  var grpc = require('grpc');
  var helloProto = grpc.load(PROTO_PATH).helloworld;

  sendMessage = function(cb) {
    client = new helloProto.Greeter('localhost:50051', grpc.credentials.createInsecure());
    client.sayHello({ name: 'Stan' }, cb);
  };
}

/**
 * grpc@^1.17.0, static codegen
 */
function runStaticModernClient() {
  log('Running static modern GRPC client.');

  var messages = require('./helloworld_pb');
  var services = require('./helloworld_grpc_pb');

  var grpc = require('grpc');

  sendMessage = function(cb) {
    client = new services.GreeterClient('localhost:50051', grpc.credentials.createInsecure());
    var request = new messages.HelloRequest();
    request.setName('Stan');
    client.sayHello(request, cb);
  };
}

/**
 * grpc@^1.17.0, dynamic codegen
 */
function runDynamicModernClient() {
  log('Running dynamic modern GRPC client.');

  var grpc = require('grpc');
  var protoLoader = require('@grpc/proto-loader');
  var packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  var helloProto = grpc.loadPackageDefinition(packageDefinition).helloworld;

  sendMessage = function(cb) {
    client = new helloProto.Greeter('localhost:50051', grpc.credentials.createInsecure());
    client.sayHello({ name: 'Stan' }, cb);
  };
}

if (process.env.WITH_STDOUT) {
  app.use(morgan(logPrefix + ':method :url :status'));
}

app.use(bodyParser.json());

app.get('/', function(req, res) {
  res.send('OK');
});

app.post('/send', function(req, res) {
  sendMessage(function(err, response) {
    if (err) {
      client.close();
      console.error(err);
      return res.status(500).send(err);
    }
    var message = typeof response.getMessage === 'function' ? response.getMessage() : response.message;
    client.close();
    return res.send({ response: message });
  });
});

app.listen(port, function() {
  log('Listening on port: ' + port);
});

function log() {
  var args = Array.prototype.slice.call(arguments);
  args[0] = logPrefix + args[0];
  console.log.apply(console, args);
}
