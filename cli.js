#!/usr/bin/env node
'use strict'

const fs = require('fs'),
  path = require('path'),
  program = require('commander'),
  packageJson = require('./package.json'),
  startServer = require('./')

program
  .version(packageJson.version)
  .option('-c, --config-file', 'load from config file. an array of config is supported.')
  .option('-F, --forward <[host:]port:remoteHost:remotePort>', 'forward host:port to remoteHost:remotePort', (r, p) => p.concat(r), [ ])
  .option('-R, --reverse <[remoteHost:]remotePort:host:port>', 'listen at remoteHost:remotePort and forward host:port', (r, p) => p.concat(r), [ ])
  .option('-P, --peer <[host:]port>', 'server address, required as client', (r, p) => p.concat(r), [ ])
  .option('-l, --listen <[host:]port>', 'listen address, required as server', (r, p) => p.concat(r), [ ])
  .option('--pfx <string>', 'pfx file path, required')
  .option('--api-address <[host:]port>', 'api server listen path')
  .option('--idle-timeout <integer>', 'seconds to wait before closing idle connections. default 30s', parseFloat, 30)
  .option('--ping-interval <integer>', 'seconds to periodically update peer ping. default 1s', parseFloat, 1)
  .option('--ping-max <integer>', 'seconds to wait for ping events before killing peer', parseFloat, 30)
  .option('--io-flush-interval <integer>', 'milliseconds to flush data, default 5ms', parseFloat, 5)
  .option('--io-max-buffer-size <integer>', 'default 40', parseFloat, 40)
  .option('--io-min-buffer-size <integer>', 'default 30', parseFloat, 30)
  .option('--sock-acknowledge-interval <integer>', 'send acknowledge message to another side every * packages. default 4', parseFloat, 4)
  .option('--sock-max-acknowledge-offset <integer>', 'pause socket until last message received. default 64', parseFloat, 64)
  .option('--sock-select-max-ping <integer>', 'ignore sockets ping of which greater than, default 30s', parseFloat, 30)
  .parse(process.argv)

if (!program.listen.length && !program.peer.length && !program.configFile) {
  program.outputHelp()
  process.exit(-1)
}

const config = program.configFile ? require(path.resolve(program.configFile)) : { },
  configList = Array.isArray(config) ? config : [config]
configList.forEach(config => startServer({ ...program, ...config }))
