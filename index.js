const through = require('through2');
const speedometer = require('speedometer');
const _ = require('lodash');
const SMOOTHING_FACTOR = 0.005;
const SKIP_INITIAL_SPEED = 3;

module.exports = function(options, onprogress) {
	if (typeof options === 'function') return module.exports(null, options);
	options = options || {};

	const speedometerSeconds = options.speed || 5;
	var length = options.length || 0;
	var time = options.time || 0;
	var drain = options.drain || false;
	var transferred = options.transferred || 0;
	var emitInterval = null;
	var speedCollection = [];
	var delta = 0;
	var speed = speedometer(speedometerSeconds);
	var startTime = Date.now();

	var update = {
		percentage: 0,
		transferred: transferred,
		length: length,
		remaining: length,
		eta: 0,
		runtime: 0
	};

	var calcAvgSpeed = function() {
		// set avgSpeed as the average value of first x set of speeds.
		if (speedCollection.length <= SKIP_INITIAL_SPEED) {
			speedCollection.push(update.speed);
			update.avgSpeed = _.round(_.sum(speedCollection) / speedCollection.length);
			update.eta = -1;
			return;
		}

		const current = SMOOTHING_FACTOR * update.speed;
		const average = (1 - SMOOTHING_FACTOR) * update.avgSpeed;
		update.avgSpeed = current + average;
		const MIN_ETA = 1;
		let eta = _.round(update.remaining / update.avgSpeed);
      	eta = eta < MIN_ETA ? MIN_ETA : eta;
		update.eta = eta;
		return;
	};

	var emit = function(ended) {
		update.delta = delta;
		if (ended) {
			update.percentage = 100;
			update.speed = 0;
			update.avgSpeed = 0;
			update.eta = 0;
		} else {
			const MIN_PERCENTAGE = 0;
			const MAX_PERCENTAGE = 99;
			const currentPercentage = length ? _.round(transferred / length * 100) : MIN_PERCENTAGE;
			update.percentage = _.clamp(currentPercentage, MIN_PERCENTAGE, MAX_PERCENTAGE);
			update.speed = speed(delta);
			calcAvgSpeed();
		}
		update.runtime = parseInt((Date.now() - startTime)/1000);

		delta = 0;

		tr.emit('progress', update);
	};
	var write = function(chunk, enc, callback) {
		var len = options.objectMode ? 1 : chunk.length;
		transferred += len;
		delta += len;
		update.transferred = transferred;
		update.remaining = length >= transferred ? length - transferred : 0;

		if (emitInterval === null) {
			emit(false);
			emitInterval = setInterval(emit, time, false);
		}
		callback(null, chunk);
	};
	var end = function(callback) {
		clearInterval(emitInterval);
		emit(true);
		callback();
	};

	var tr = through(options.objectMode ? {objectMode:true, highWaterMark:16} : {}, write, end);
	var onlength = function(newLength) {
		length = newLength;
		update.length = length;
		update.remaining = length - update.transferred;
		tr.emit('length', length);
	};
	
	// Expose `onlength()` handler as `setLength()` to support custom use cases where length
	// is not known until after a few chunks have already been pumped, or is
	// calculated on the fly.
	tr.setLength = onlength;
	
	tr.on('pipe', function(stream) {
		if (typeof length === 'number') return;
		// Support http module
		if (stream.readable && !stream.writable && stream.headers) {
			return onlength(parseInt(stream.headers['content-length'] || 0));
		}

		// Support streams with a length property
		if (typeof stream.length === 'number') {
			return onlength(stream.length);
		}

		// Support request module
		stream.on('response', function(res) {
			if (!res || !res.headers) return;
			if (res.headers['content-encoding'] === 'gzip') return;
			if (res.headers['content-length']) {
				return onlength(parseInt(res.headers['content-length']));
			}
		});
	});

	if (drain) tr.resume();
	if (onprogress) tr.on('progress', onprogress);

	tr.progress = function() {
		update.speed = speed(0);
		calcAvgSpeed();

		return update;
	};
	return tr;
};
