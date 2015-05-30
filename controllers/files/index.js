var _ = require('lodash');
var async = require('async');
var path = require('path');
var fs = require('fs');
var child_process = require('child_process');
var formidable = require('formidable');

var logger = require('loge');
var Router = require('regex-router');

var pdfi = require('pdfi');
var pdfi_PDF = require('pdfi/PDF');
var pdfi_graphics = require('pdfi/graphics');
var pdfi_Arrays = require('pdfi/Arrays');

var _pdf_cache = {};
pdfi.setLoggerLevel(logger.level);
var files_dirpath = process.env.UPLOADS;

var R = new Router(function(req, res) {
  res.status(404).die('No resource at: ' + req.url);
});

/** GET /files
List uploaded files
*/
R.get(/^\/files$/, function(req, res) {
  fs.readdir(files_dirpath, function(err, filenames) {
    if (err) return res.die(err);
    filenames = filenames.filter(function(filename) {
      // stupid Mac OS X with your .DS_Store files
      return !filename.match(/^\./);
    });

    async.map(filenames, function(filename, callback) {
      var filepath = path.join(files_dirpath, filename);
      fs.stat(filepath, function(err, stats) {
        callback(err, {name: filename, size: stats.size});
      });
    }, function(err, files) {
      if (err) return res.die(err);
      res.json(files);
    });
  });
});

/** POST /files
Upload new file
*/
R.post(/^\/files$/, function(req, res) {
  /** formidable.IncomingForm#parse(request: http.IncomingMessage,
                                    callback: (...))

  The `files` object in the callback is keyed by the field name used by the
  client.

  Depending on the whether the client sent one or multiple files with
  the same field name, the `files` object's values will be a File, or an Array
  of Files. Not the API design I would have chosen, but easy enough to coalesce
  to an Array.

  Example `files` object (where the client sent a single file on with the field
  name "file":

      {
        "file": {
          "size": 899791,
          "path": "/var/folders/m8/cq7z9jxj0774qz_3yg0kw5k40000gn/T/upload_c93ff63b9905c00ca7c8b778dab527f0",
          "name": "5th-cat.jpg",
          "type": "application/pdf",
          "mtime": "2015-02-13T11:34:47.811Z"
        }
      }
  */
  new formidable.IncomingForm({multiples: true})
  .on('fileBegin', function(name, file) {
    file.path = path.join(files_dirpath, file.name);
    logger.debug('fileBegin', name, file);
  })
  .parse(req, function(err, fields, files) {
    if (err) return res.die(err);
    var file = files.file || {};
    res.json({name: file.name, size: file.size, type: file.type, lastModifiedDate: file.lastModifiedDate});
  });
});

// per-file routes

/** GET /files/:name
*/
R.get(/^\/files\/([^\/]+)$/, function(req, res, m) {
  res.json({
    // Angular model updating wants the name here too:
    name: decodeURIComponent(m[1]),
    size: req.pdf.size,
    trailer: _.omit(req.pdf.trailer._object, 'ID'), // who needs/wants the ID?
    cross_references: req.pdf.cross_references,
  });
});

/** GET /files/:name/document
*/
R.get(/^\/files\/([^\/]+)\/document$/, function(req, res) {
  var paper = req.pdf.renderPaper();

  var spans = pdfi_Arrays.flatMap(req.pdf.pages, function(page) {
    return pdfi_graphics.renderPageLayout(page).textSpans;
  });

  var fontSizes = spans.map(function(textSpan) { return textSpan.fontSize; });
  var fontSize_quartiles = pdfi_Arrays.quantile(fontSizes, 4);

  res.json({paper: paper, spans: spans, fontSize_quartiles: fontSize_quartiles});
});

/** POST /files/:name/open
Open the given PDF in Preview.app or whatever.
*/
R.post(/^\/files\/([^\/]+)\/open$/, function(req, res, m) {
  var name = decodeURIComponent(m[1]);
  child_process.spawn('open', [name], {
    cwd: files_dirpath,
    stdio: 'ignore',
    detached: true,
  }).on('close', function(code) {
    if (code !== 0) return res.die(code);
    res.json({message: 'Opened ' + name});
  }).unref();
});

R.any(/^\/files\/([^\/]+)\/objects/, require('./objects'));
R.any(/^\/files\/([^\/]+)\/pages/, require('./pages'));

module.exports = function(req, res) {
  logger.debug('%s %s', req.method, req.url);
  // Set req.pdf on all requests that specify a file name
  var m = req.url.match(/^\/files\/([^\/]+)(\/|\?|$)/);
  if (m) {
    var name = decodeURIComponent(m[1]);
    try {
      if (!(name in _pdf_cache)) {
        var filepath = path.join(files_dirpath, name);
        _pdf_cache[name] = pdfi_PDF.open(filepath);
      }
      req.pdf = _pdf_cache[name];
    }
    catch (error) {
      return res.die(error);
    }
  }
  R.route(req, res);
};
