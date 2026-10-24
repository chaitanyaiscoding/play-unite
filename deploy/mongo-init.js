// Runs once, when the MongoDB volume is first created: a least-privilege user
// the app connects with (read/write on the play-unite database only).
db.getSiblingDB('play-unite').createUser({
  user: process.env.MONGO_APP_USER,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: 'play-unite' }],
});
