import http from 'http';

// Cliente da API local do Mestrônomo (http://127.0.0.1:7777/api/...).

const PORT = Number(process.env.MESTRONOMO_PORT || 7777);

/** GET em /api/<rota>. Rejeita se o Mestrônomo não estiver aberto. */
export function api(route) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: `/api/${route}`, timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          res.statusCode >= 400 ? reject(new Error(data.erro || `HTTP ${res.statusCode}`)) : resolve(data);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

export const encode = (s) => encodeURIComponent(s);
