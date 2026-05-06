module.exports = (req, res) => {
  const isConfigured = Boolean(
    process.env.MOKA_CLIENT_ID && 
    process.env.MOKA_CLIENT_SECRET && 
    process.env.MOKA_REDIRECT_URI
  );
  
  res.json({
    mokaConfigured: isConfigured,
    hasClientId: !!process.env.MOKA_CLIENT_ID,
    clientIdLength: process.env.MOKA_CLIENT_ID?.length || 0,
    clientIdPrefix: process.env.MOKA_CLIENT_ID?.substring(0, 10) + '...',
    hasClientSecret: !!process.env.MOKA_CLIENT_SECRET,
    hasRedirectUri: !!process.env.MOKA_REDIRECT_URI,
    redirectUri: process.env.MOKA_REDIRECT_URI,
    mokaOutletId: process.env.MOKA_OUTLET_ID,
    appBaseUrl: process.env.APP_BASE_URL,
    timestamp: new Date().toISOString()
  });
};
