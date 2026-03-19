# AposteMais Admin Dashboard

Painel administrativo do AposteMais, hospedado via GitHub Pages.

## Como usar

1. Abra https://apostafacil-app.github.io/apostemais-admin/
2. Insira o `ADMIN_SECRET` configurado no backend
3. Pronto — dados carregados em tempo real

## Métricas disponíveis

- Clientes totais / Licenças ativas / MRR estimado / Receita total
- Licenças vencendo em 7 dias / Expiradas (churn)
- Gráfico: Novas licenças por mês (6 meses)
- Gráfico: Distribuição por plano (mensal/semestral/anual)
- Tabela paginada de licenças com status

## Backend necessário

Requer o arquivo `backend/admin.js` copiado para `src/routes/admin.js`
no repositório `apostemais-backend` + variável de ambiente `ADMIN_SECRET`.

Veja instruções em `backend/admin.js`.
