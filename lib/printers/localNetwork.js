function getPrimaryLocalIP(interfaces) {
  const candidates = Object.values(interfaces || {}).flat().filter(info =>
    (info.family === "IPv4" || info.family === 4) && !info.internal && !/^169\.254\./.test(info.address));
  const privateAddress = candidates.find(info => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(info.address));
  return (privateAddress || candidates[0])?.address || "127.0.0.1";
}
module.exports = { getPrimaryLocalIP };
