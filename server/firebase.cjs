'use strict';
function services() {
  const {initializeApp,getApps,cert} = require('firebase-admin/app');
  const {getAuth} = require('firebase-admin/auth');
  const {getDatabase} = require('firebase-admin/database');
  if (!getApps().length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) throw new Error('Sunucu Firebase yapılandırması eksik.');
    initializeApp({credential:cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),databaseURL:process.env.FIREBASE_DATABASE_URL});
  }
  return {auth:getAuth(),db:getDatabase()};
}
module.exports = {services};
