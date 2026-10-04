(function (global) {
  'use strict';
  var DB = 'mentria-push', STORE = 'pending', VER = 1;
  var dbp = null;
  function open() {
    if (dbp) return dbp;
    var p = new Promise(function (resolve, reject) {
      var req = global.indexedDB.open(DB, VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'scheduleId' });
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { db.close(); if (dbp === p) dbp = null; };
        db.onclose = function () { if (dbp === p) dbp = null; };
        resolve(db);
      };
      req.onerror = function () { if (dbp === p) dbp = null; reject(req.error); };
    });
    dbp = p;
    return p;
  }
  function run(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s);
      t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
      t.onerror = function () { reject(t.error); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return run(db, mode, fn).catch(function (err) {
        if (!err || err.name !== 'InvalidStateError') throw err;
        dbp = null;
        return open().then(function (fresh) { return run(fresh, mode, fn); });
      });
    });
  }
  global.MentriaPushDB = {
    putPending: function (spec) { return tx('readwrite', function (s) { s.put(spec); }); },
    getPending: function (id) { return tx('readonly', function (s) { return s.get(id); }); },
    deletePending: function (id) { return tx('readwrite', function (s) { s.delete(id); }); },
    allPending: function () { return tx('readonly', function (s) { return s.getAll(); }); },
    kvGet: function (key) {
      return tx('readonly', function (s) { return s.get('kv-' + key); }).then(function (row) {
        return row ? row.value : undefined;
      });
    },
    kvSet: function (key, value) {
      return tx('readwrite', function (s) { s.put({ scheduleId: 'kv-' + key, value: value }); });
    }
  };
})(typeof self !== 'undefined' ? self : this);
