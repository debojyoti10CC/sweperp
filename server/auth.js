import { createHash, randomBytes } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';
import { AppError } from './errors.js';

const COOKIE = 'perplab_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const hash = token => createHash('sha256').update(token).digest('hex');

export function sessionKey(req) {
  const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='));
  const token = cookie?.slice(COOKIE.length + 1);
  return token && /^[0-9a-f]{64}$/.test(token) ? hash(token) : null;
}

export function walletAuth(store) {
  return {
    async challenge(input, origin) {
      const { chainId, address: value } = input;
      let address;
      try { address = getAddress(value); } catch { throw new AppError(400, 'A valid Ethereum wallet address is required.'); }
      if (!Number.isSafeInteger(chainId) || chainId < 1) throw new AppError(400, 'A valid wallet network is required.');
      const nonce = randomBytes(16).toString('hex');
      const issuedAt = new Date();
      const expiresAt = new Date(+issuedAt + 5 * 60 * 1000);
      const message = [
        origin + ' wants you to sign in with your Ethereum account:',
        address, '', 'Sign in to PerpLab. This signature will not move funds.', '',
        'URI: ' + origin + '/', 'Version: 1', 'Chain ID: ' + chainId, 'Nonce: ' + nonce,
        'Issued At: ' + issuedAt.toISOString(), 'Expiration Time: ' + expiresAt.toISOString(),
      ].join('\n');
      await store.challenges.insertOne({ _id: nonce, address, message, origin, expiresAt });
      return { nonce, message };
    },
    async verify(input, origin) {
      const { nonce, signature } = input;
      if (typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce) ||
        typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
        throw new AppError(400, 'A valid wallet signature is required.');
      }
      const filter = { _id: nonce, origin, expiresAt: { $gt: new Date() } };
      const challenge = await store.challenges.findOne(filter);
      if (!challenge) throw new AppError(401, 'This sign-in request expired or was already used. Connect again.');
      let signer;
      try { signer = verifyMessage(challenge.message, signature); } catch { /* invalid signature */ }
      if (signer !== challenge.address) throw new AppError(401, 'The signature does not match the requested wallet.');
      if (!await store.challenges.findOneAndDelete(filter)) {
        throw new AppError(401, 'This sign-in request was already used. Connect again.');
      }
      const account = await store.ensureAccount(challenge.address);
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_MS);
      await store.sessions.insertOne({ _id: hash(token), accountId: account._id, expiresAt, origin });
      return { token, account };
    },
    session(req) {
      const id = sessionKey(req);
      return id ? store.sessions.findOne({ _id: id, expiresAt: { $gt: new Date() } }) : null;
    },
    async logout(req) {
      const id = sessionKey(req);
      if (id) await store.sessions.deleteOne({ _id: id });
      return id;
    },
  };
}

export function sessionCookie(res, origin, token) {
  const options = { httpOnly: true, sameSite: 'strict', secure: origin.startsWith('https:'), path: '/' };
  if (token) res.cookie(COOKIE, token, { ...options, maxAge: SESSION_MS });
  else res.clearCookie(COOKIE, options);
}
