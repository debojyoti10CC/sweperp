import { createHash, randomBytes } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';
import { SiweMessage } from 'siwe';
import { AppError } from './errors.js';

const COOKIE = 'perplab_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const hash = token => createHash('sha256').update(token).digest('hex');

function sessionKey(req, name) {
  const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='));
  const token = cookie?.slice(name.length + 1);
  return token && /^[0-9a-f]{64}$/.test(token) ? hash(token) : null;
}

export function walletAuth(store, networkId) {
  const cookieName = networkId ? COOKIE + '_' + networkId : COOKIE;
  const scope = networkId ? { networkId } : {};
  const filterScope = networkId ? scope : { networkId: { $exists: false } };
  return {
    async challenge(input, origin) {
      const { chainId, address: value } = input;
      let address;
      try { address = getAddress(value); } catch { throw new AppError(400, 'A valid Ethereum wallet address is required.'); }
      if (!Number.isSafeInteger(chainId) || chainId < 1) throw new AppError(400, 'A valid wallet network is required.');
      if (networkId && chainId !== networkId) throw new AppError(400, 'Switch your wallet to the PerpLab test network.');
      const nonce = randomBytes(16).toString('hex');
      const issuedAt = new Date();
      const expiresAt = new Date(+issuedAt + 5 * 60 * 1000);
      const message = new SiweMessage({
        domain: new URL(origin).host, address, statement: 'Sign in to PerpLab for paper trading.',
        uri: origin + '/', version: '1', chainId, nonce, issuedAt: issuedAt.toISOString(), expirationTime: expiresAt.toISOString(),
      }).prepareMessage();
      await store.challenges.insertOne({ _id: nonce, address, message, origin, expiresAt, ...scope });
      return { nonce, message };
    },
    async verify(input, origin) {
      const { nonce, signature } = input;
      if (typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce) ||
        typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
        throw new AppError(400, 'A valid wallet signature is required.');
      }
      const filter = { _id: nonce, origin, expiresAt: { $gt: new Date() }, ...filterScope };
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
      await store.sessions.insertOne({ _id: hash(token), accountId: account._id, expiresAt, origin, ...scope });
      return { token, account };
    },
    session(req) {
      const id = sessionKey(req, cookieName);
      return id ? store.sessions.findOne({ _id: id, expiresAt: { $gt: new Date() }, ...filterScope }) : null;
    },
    async logout(req) {
      const id = sessionKey(req, cookieName);
      if (id) await store.sessions.deleteOne({ _id: id, ...filterScope });
      return id;
    },
    cookie(res, origin, token) {
      const options = { httpOnly: true, sameSite: 'strict', secure: origin.startsWith('https:'), path: '/' };
      if (token) res.cookie(cookieName, token, { ...options, maxAge: SESSION_MS });
      else res.clearCookie(cookieName, options);
    },
  };
}
