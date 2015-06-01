var os = require('os');
var fs = require('fs');
var path = require('path');
var url = require('url');

var logger = require('loge');
var Router = require('regex-router');

var pdfi = require('pdfi');

var R = new Router(function(req, res) {
  res.status(404).die('No resource at: ' + req.url);
});

R.any(/^\/files/, require('./files'));

function generateRandomTimestamp() {
  return new Date().toISOString().replace(/-:/g, '') + (Math.random() * 9000 + 10000).toFixed(0);
}

/** POST /readFile?type=paper|string|metadata|xref
Upload new file.
*/
R.post(/^\/readFile(\?|$)/, function(req, res) {
  var type = url.parse(req.url, true).query.type || 'paper';
  var filename = (req.headers['x-filename'] || (generateRandomTimestamp() + '.pdf')).replace(/[^-a-z0-9._]+/gi, '');
  var filepath = path.join(os.tmpdir(), filename);
  logger.info('writing temporary file: "%s"', filepath);
  req.pipe(fs.createWriteStream(filepath)).on('finish', function() {
    logger.info('reading %s from file: "%s"', type, filepath);
    var data = pdfi.readFileSync(filepath, {type: type});
    res.json(data);
  });
});

R.get(/^\/version$/, function(req, res) {
  var version = require('../package').version;
  res.text(version);
});

R.get(/^\/rev$/, function(req, res) {
  var refs_head_master = path.join(__dirname, '..', '.git', 'refs', 'heads', 'master');
  fs.readFile(refs_head_master, {encoding: 'utf8'}, function(err, data) {
    if (err) return res.die(err.message);
    res.text(data);
  });
});

module.exports = R.route.bind(R);
