#!/usr/bin/env node
"use strict";
/*!
 * CLI version of rpi-fan-controller, no programming needed!
 * @author Kyle Ross
 */

let RPIFanController = require('../'),
    yargs = require('yargs');

let argv = yargs
            .usage('$0 [options]')
            .options({
                pinmode: {
                    alias: 'm',
                    describe: 'Pin mode to use',
                    type: 'string',
                    choices: ['bcm', 'rpi'],
                    default: 'bcm'
                },
                pin: {
                    alias: 'p',
                    describe: 'GPIO pin number to use',
                    type: 'number',
                    default: 18
                },
                query: {
                    alias: 'q',
                    describe: 'Time in seconds to query CPU temperature',
                    type: 'number',
                    default: 10
                },
                maxtemp: {
                    alias: 't',
                    describe: 'Maximum temperature to turn on fan in celsius',
                    type: 'number',
                    default: 45
                },
                'run-until-temp': {
                    alias: 'u',
                    describe: 'Run fan until this temperature is reached in celsius',
                    type: 'number',
                    default: 0
                },
                criticaltemp: {
                    alias: 'c',
                    describe: 'Forces fan to run when this temperature is reached in celsius',
                    type: 'number',
                    default: 70
                },
                'min-fan-run-time': {
                    describe: 'Minimum time in seconds to run the fan',
                    type: 'number',
                    default: 60
                },
                'max-fan-run-time': {
                    describe: 'Maximum time in seconds to run the fan',
                    type: 'number',
                    default: 0
                },
                'min-fan-off-time': {
                    describe: 'Minimum time in seconds to keep fan off before running again',
                    type: 'number',
                    default: 60
                }
            })
            .help()
            .version()
            .argv;

let options = {
    pinMode: argv.pinmode,
    pin: argv.pin,
    maxTemp: argv.maxtemp,
    runUntilTemp: argv['run-until-temp'],
    criticalTemp: argv.criticaltemp,
    minFanRunTime: argv['min-fan-run-time'],
    maxFanRunTime: argv['max-fan-run-time'],
    minFanOffTime: argv['min-fan-off-time'],
    autoInterval: argv.query
};

let rpiFan = new RPIFanController(options);

rpiFan.on('dispose', function() {
    process.exit();
});

rpiFan.on('sigint', function() {
    process.exit();
});

rpiFan.auto();

