import { handleRequest } from './handler.js';

export default {
  fetch(request, env, ctx) {
    return handleRequest(request);
  },
};
