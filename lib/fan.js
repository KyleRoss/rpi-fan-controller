"use strict";
const gpio = require('rpi-gpio');
const debug = require('debug')('rpifan');
const exec = require('child_process').exec;
const EventEmitter = require('events').EventEmitter;

/**
 * @class RPIFanController
 */
class RPIFanController extends EventEmitter {
    /**
     * Constructor for the RPIFanController class
     * @param  {Object} options               Options object to pass to the class
     * @param  {string} options.pinMode       The pinMode to use. Can be either "BCM" or "RPI". Default is BCM.
     * @param  {number} options.pin           The pin number to control. Default is 18.
     * @param  {number} options.maxTemp       The maximum temp in which the fan will turn on in celsius. Default is 45.
     * @param  {number} options.runUntilTemp  Forces the fan to run until this temperature is reached in celsius. Default is 38, 0 disables.
     * @param  {number} options.criticalTemp  Critical temperature in celcius to force the fans on ignoring all rules. Default is 70.
     * @param  {number} options.minFanRunTime Minimum time to run the fan in seconds. Default is 60, 0 disables.
     * @param  {number} options.maxFanRunTime Maximum time to run the fan in seconds, ignoring `runUntilTemp` and `maxTemp`. Default is 0, 0 = unlimited.
     * @param  {number} options.minFanOffTime Minimum time to keep the fan off in seconds, ignoring `maxTemp`. Default is 60, 0 disables.
     * @param  {number} options.pollInterval  Time in seconds to check CPU temperature when using `auto()`. Default is 10.
     * @return {this}                         The instance of the class
     */
    constructor(options) {
        super();
        
        let self = this;
        
        /**
         * Default options object
         * @private
         * @type {Object}
         */
        this._defaultOptions = {
            pinMode: 'BCM',
            pin: 18,
            maxTemp: 45,
            runUntilTemp: 0,
            criticalTemp: 70,
            minFanRunTime: 60,
            maxFanRunTime: 0,
            minFanOffTime: 60,
            pollInterval: 10
        };
        
        /**
         * Stores the current fan status internally. Do not manually change this.
         * @private
         * @type {Number}
         */
        this._fanStatus = 0;
        /**
         * Stores timestamp of the last time the fan was on
         * @private
         * @type {Number}
         */
        this._lastOn = null;
        /**
         * Flag that states if the pin has been initalized
         * @private
         * @type {Boolean}
         */
        this._pinReady = false;
        /**
         * Stores the current CPU temperature
         * @private
         * @type {Number}
         */
        this._currentTemp = 0;
        
        process.on('SIGINT', function() {
            debug('SIGINT event fired, gracefully shutting down');
            self.dispose(function() {
                self.emit('sigint');
            });
        });
        
        if(typeof options !== 'object') options = {};
        
        /**
         * Compiled options object
         * @private
         * @type {Object}
         */
        this._opts = Object.assign({}, this._defaultOptions, options);
        
        debug('options set %O', this._opts);
    }
    
    /**
     * Initalizes GPIO pin, required in order to control the fan
     * @param  {Function} cb Optional callback function to call with `err` and `status`.
     * @return {this}        Instance of the class
     */
    init(cb) {
        let self = this,
            mode = this._opts.pinMode.toUpperCase() === 'RPI'? 'MODE_RPI' : 'MODE_BCM';
        
        function onPinReady() {
            if(typeof cb === 'function') return cb(null, true);
        }
        
        if(this._pinReady) {
            return onPinReady();
        }
        
        debug('setting pin mode to %s', mode);
        gpio.setMode(gpio[mode]);
        
        debug('initalizing pin %d for output', this._opts.pin);
        gpio.setup(this._opts.pin, gpio.DIR_OUT, function(err) {
            if(err) {
                debug('unable to initalize due to error');
                console.error(err);
                self.dispose();
                
                if(typeof cb === 'function') return cb(err, false);
                throw err;
            }
            
            debug('pin %d is ready for communication', self._opts.pin);
            self._pinReady = true;
            
            if(self._cpuTimer) clearInterval(self._cpuTimer);
            
            self._cpuTimer = setInterval(function() {
                self.getCPUTemp();
            }, self._opts.pollInterval * 1000 || 1);
            
            self.getCPUTemp(function(err) {
                if(err) {
                    self.dispose();
                    if(typeof cb === 'function') return cb(err, false);
                    throw err;
                }
                
                onPinReady();
                self.emit('ready');
            });
        });
        
        return this;
    }
    
    /**
     * Automatically runs all logic needed to control the fan based on the provided options.
     * @return {Function} An `autoStop()` function to call to stop the process.
     */
    auto() {
        let self = this;
        this._autoTimer = null;
        
        function fanController() {
            self.fanStatus = self.testTemp();
        }
        
        this.init(function(err) {
            if(err) {
                self.dispose();
                throw err;
            }
            
            if(self._autoTimer) clearInterval(self._autoTimer);
            
            self._autoTimer = setInterval(function() {
                fanController();
            }, self._opts.pollInterval * 1000 || 1);
            
            fanController();
        });
        
        return function autoStop(cb) {
            self.dispose(cb);
            return self;
        };
    }
    
    /**
     * Runs all the tests and determines what the fan status should be.
     * @return {Boolean} Whether the fan should be on `true` or off `false` based on the rules.
     */
    testTemp() {
        let self = this,
            opts = this._opts,
            temp = this.cpuTemp;
        
        let status = false,
            current = self.fanStatus;
        
        if(temp >= opts.maxTemp) status = true;
        if(opts.runUntilTemp) {
            if(temp <= opts.runUntilTemp) status = false;
            else status = true;
        }
        
        if(this._lastOn) {
            // if the fan is currently on...
            if(current) {
                if(opts.minFanRunTime && !status) {
                    if(new Date().getTime() - self._lastOn <= (opts.minFanRunTime * 1000)) status = true;
                }
                if(opts.maxFanRunTime && status) {
                    if(new Date().getTime() - self._lastOn >= (opts.maxFanRunTime * 1000)) status = false;
                }
            }
            
            // if the fan is currently off and new status will be true...
            if(!current && status && opts.minFanOffTime) {
                if(new Date().getTime() - self._lastOn < (opts.minFanOffTime * 1000)) status = false;
            }
        }
        
        if(opts.criticalTemp && temp >= opts.criticalTemp) status = true;
        
        return status;
    }
    
    /**
     * Queries for the current CPU temperature
     * @param  {Function} cb Callback function to call with `err` and `temp`.
     * @return {this}        Instance of the class
     */
    getCPUTemp(cb) {
        let self = this;
        if(typeof cb !== 'function') cb = function() {};
        
        exec('vcgencmd measure_temp', function(err, stdout, stderror) {
            if(err) {
                debug('error while getting cpu temp');
                console.error(err);
                return cb(err);
            }
            
            let temp = +stdout.replace(/temp=/, '').replace(/'C\n/, '');
            debug('current cpu temp: %d', temp);
            
            if(isNaN(temp)) {
                debug('cpu temp is not a number, defaulting to 0');
                temp = 0;
            }
            
            if(self.cpuTemp !== temp && temp) {
                self.cpuTemp = temp;
            }
            
            return cb(null, self.cpuTemp);
        });
        
        return this;
    }
    
    /**
     * Toggles the fan based on provided `status`.
     * @param  {Boolean}   status Turn on the fan `true` or off `false`.
     * @param  {Function} cb     Optional callback function to call with `err` and `status`.
     * @return {this}            Instance of the class
     */
    toggleFan(status, cb) {
        let self = this;
        if(typeof cb !== 'function') cb = function() {};
        
        if(!this._pinReady) {
            cb(new Error('Pin is not ready, you must use `init()` first'));
            return this;
        }
        
        gpio.write(this._opts.pin, status, function(err) {
            if(err) {
                debug('error while writing to pin');
                console.error(err);
                self.dispose();
                return cb(err);
            }       
            
            self._fanStatus = +status;
            self._lastOn = new Date().getTime();
            
            debug('fan is now %s', status? 'on' : 'off');
            self.emit('change', +status);
            cb(null, +status);
        });
        
        return this;
    }
    
    /**
     * Gets the current status of the fan
     * @return {Number} Status: 0 = off, 1 = on
     */
    get fanStatus() {
        return this._fanStatus;
    }
    
    /**
     * Sets the current status of the fan, triggering `toggleFan()`.
     * @param  {Number} status The new status, 0 = off, 1 = on
     */
    set fanStatus(status) {
        if(this._fanStatus !== +status) {
            this._fanStatus = +status;
            this.toggleFan(this._fanStatus);
        }
    }
    
    /**
     * Gets the current CPU temperature from the last poll
     * @return {Number} Current CPU temperature in celsius
     */
    get cpuTemp() {
        return this._currentTemp;
    }
    
    /**
     * Sets the current CPU temperature and emits `tempChange` event
     * @param  {Number} temp Temperature in celsius to store
     */
    set cpuTemp(temp) {
        if(this._currentTemp !== temp) {
            this._currentTemp = temp;
            this.emit('tempChange', temp);
        }
    }
    
    /**
     * Disposes and gracefully shutsdown GPIO pin along with turning off the fan.
     * @param  {Function} cb Optional callback to call after disposed.
     * @return {this}        Instance of the class
     */
    dispose(cb) {
        let self = this;
        if(this._autoTimer) clearInterval(this._autoTimer);
        if(this._cpuTimer) clearInterval(this._cpuTimer);
        
        this.toggleFan(0, function() {
            gpio.destroy();
            self._pinReady = false;
            
            self.emit('dispose');
            if(typeof cb === 'function') cb();
        });
        
        return this;
    }
}

RPIFanController.gpio = gpio;
module.exports = RPIFanController;
