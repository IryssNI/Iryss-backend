module.exports = (err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  if (status === 500) {
    console.error(`[ERROR] ${req.method} ${req.path} — ${err.name || 'Error'}`);
  }

  res.status(status).json({ error: message });
};
