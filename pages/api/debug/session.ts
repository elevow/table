import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Get session token from Authorization header or cookies
  const authHeader = req.headers.authorization;
  const sessionToken = authHeader?.replace('Bearer ', '') || req.cookies.session_token || req.cookies.auth_token;

  return res.status(200).json({
    hasAuthHeader: !!authHeader,
    hasSessionToken: !!sessionToken,
    sessionTokenPreview: sessionToken ? sessionToken.slice(0, 10) + '...' : null,
    cookies: req.cookies,
    adminEmails: process.env.ADMIN_EMAILS,
    requestHeaders: {
      authorization: req.headers.authorization,
      cookie: req.headers.cookie
    },
    localStorage: {
      auth_token: 'Check in browser console: localStorage.getItem("auth_token")',
      session_token: 'Check in browser console: localStorage.getItem("session_token")'
    }
  });
}