var Service, Characteristic
const packageJson = require('./package.json')
const request = require('request')

module.exports = function (homebridge) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  homebridge.registerAccessory('homebridge-tasmota-lock', 'TasmotaLock', TasmotaLock)
}

function TasmotaLock (log, config) {
  this.log = log

  this.name = config.name
  this.hostname = config.hostname
  this.negative = config.negative || false

  this.autoLock = config.autoLock || false
  this.autoLockDelay = config.autoLockDelay || 10

  this.manufacturer = config.manufacturer || packageJson.author.name
  this.serial = config.serial || this.name
  this.model = config.model || packageJson.name
  this.firmware = config.firmware || packageJson.version

  this.username = config.username || null
  this.password = config.password || null
  this.timeout = config.timeout || 5000
  this.http_method = 'GET'

  this.pollInterval = config.pollInterval || 120

  if (this.username != null && this.password != null) {
    this.auth = {
      user: this.username,
      pass: this.password
    }
  }

  this.service = new Service.LockMechanism(this.name)
}

TasmotaLock.prototype = {

  identify: function (callback) {
    this.log('Identify requested!')
    callback()
  },

  _httpRequest: function (url, body, method, callback) {
    request({
      url: url,
      body: body,
      method: this.http_method,
      timeout: this.timeout,
      rejectUnauthorized: false,
      auth: this.auth
    },
    function (error, response, body) {
      callback(error, response, body)
    })
  },

  _getStatus: function (callback) {
    var url = 'http://' + this.hostname + '/cm?cmnd=power'
    this.log.debug('Getting status: %s', url)

    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log.warn('Error getting status: %s', error.message)
        this.service.getCharacteristic(Characteristic.LockCurrentState).updateValue(new Error('Polling failed'))
        callback(error)
      } else {
        this.log.debug('Device response: %s', responseBody)
        var json = JSON.parse(responseBody)
        var state = (json.POWER == "ON")

        if(this.negative) {
          state = !state;
        }


        this.service.getCharacteristic(Characteristic.LockCurrentState).updateValue(state)
        this.service.getCharacteristic(Characteristic.LockTargetState).updateValue(state)
        this.log.debug('Updated state to: %s', state)
        callback()
      }
    }.bind(this))
  },

  setLockTargetState: function (value, callback) {

    var cmd = value ? (this.negative ? "off" : "on") : (this.negative ? "on" : "off")

    var url = 'http://' + this.hostname + '/cm?cmnd=Power%20' + cmd
    this.log.debug('Setting state: %s', url)

    this._httpRequest(url, '', this.http_method, function (error, response, responseBody) {
      if (error) {
        this.log.warn('Error setting state: %s', error.message)
        callback(error)
      } else {
        this.log('Set state to %s', value)
        this.service.getCharacteristic(Characteristic.LockCurrentState).updateValue(value)
        if (value === 1 && this.autoLock) {
          this.autoLockFunction()
        }
        callback()
      }
    }.bind(this))
  },

  autoLockFunction: function () {
    this.log('Waiting %s seconds for autolock', this.autoLockDelay)
    setTimeout(() => {
      this.service.setCharacteristic(Characteristic.LockTargetState, 1)
      this.log('Autolocking...')
    }, this.autoLockDelay * 1000)
  },

  getServices: function () {
    this.informationService = new Service.AccessoryInformation()
    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serial)
      .setCharacteristic(Characteristic.FirmwareRevision, this.firmware)

    this.service
      .getCharacteristic(Characteristic.LockTargetState)
      .on('set', this.setLockTargetState.bind(this))

    this._getStatus(function () {})

    setInterval(function () {
      this._getStatus(function () {})
    }.bind(this), this.pollInterval * 1000)

    return [this.informationService, this.service]
  }
}
