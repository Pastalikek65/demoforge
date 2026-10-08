import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function createShop() {
  return createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Paper & Pine — DemoForge fixture</title><style>body{font:18px system-ui;background:#f7f3ec;color:#24352d;max-width:640px;margin:60px auto;padding:24px}label{display:block;margin:24px 0}input,select,button{font:inherit;padding:12px;border:1px solid #89948b;border-radius:6px}input,select{display:block;width:100%;box-sizing:border-box}button{background:#245646;color:white;cursor:pointer}#result{padding:24px;background:#e1eddf;margin-top:24px}</style><h1>Paper & Pine</h1><p>Order a notebook. This example stores nothing and sends no data.</p><form id="order"><label>Your name<input data-testid="customer" id="customer" autocomplete="off"></label><label>Notebook<select data-testid="notebook"><option value="field">Field notes · $12</option><option value="studio">Studio journal · $18</option></select></label><button data-testid="order" type="submit">Create sample order</button></form><section id="result" data-testid="result" hidden aria-live="polite"></section><script>document.getElementById('order').addEventListener('submit',event=>{event.preventDefault();const result=document.getElementById('result');result.textContent='Sample order ready for '+document.getElementById('customer').value+'. No payment was taken.';result.hidden=false;});</script></html>`);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createShop();
  server.listen(Number(process.env.PORT ?? 4077), '127.0.0.1', () => console.log(`Synthetic demo: http://127.0.0.1:${server.address().port}`));
}
