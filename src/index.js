import { handleRequest } from './handler.js';

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
};
