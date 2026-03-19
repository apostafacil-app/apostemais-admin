/**
 * src/routes/admin.js
 * Rotas administrativas — protegidas por ADMIN_SECRET
 *
 * Como usar:
 *   1. Copie este arquivo para src/routes/admin.js no apostemais-backend
 *   2. No src/index.js, adicione:
 *        const adminRouter = require('./routes/admin');
 *        const limiterAdmin = rateLimit({ windowMs: 60*60*1000, max: 30 });
 *        app.use('/admin', limiterAdmin, adminRouter);
 *   3. No cors(), adicione 'https://apostafacil-app.github.io' às origens permitidas
 *   4. No Railway, adicione a variável de ambiente ADMIN_SECRET com uma senha forte
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../utils/supabase');
const logger = require('../utils/logger');

// Preços por plano (em R$)
const PRECOS = { mensal: 9.90, semestral: 49.90, anual: 89.90 };

// ── Middleware de autenticação ──────────────────────────────────────────────
function authAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!process.env.ADMIN_SECRET || token !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  next();
}

router.use(authAdmin);

// ── GET /admin/metricas ─────────────────────────────────────────────────────
router.get('/metricas', async (req, res) => {
  try {
    const agora = new Date().toISOString();
    const em7Dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Executa queries em paralelo
    const [
      totalClientesRes,
      licencasAtivasRes,
      licencasExpiradasRes,
      vencendo7Res,
      todasLicencasRes,
      clientesMesRes,
      licencasMesRes,
    ] = await Promise.all([
      // Total de clientes
      supabase.from('clientes').select('*', { count: 'exact', head: true }),

      // Licenças ativas (não expiradas e ativo = true)
      supabase
        .from('licencas')
        .select('*', { count: 'exact', head: true })
        .eq('ativo', true)
        .gt('vence_em', agora),

      // Licenças expiradas
      supabase
        .from('licencas')
        .select('*', { count: 'exact', head: true })
        .lt('vence_em', agora),

      // Vencendo em 7 dias
      supabase
        .from('licencas')
        .select('*', { count: 'exact', head: true })
        .eq('ativo', true)
        .gt('vence_em', agora)
        .lt('vence_em', em7Dias),

      // Todas as licenças ativas (para calcular receita e distribuição por plano)
      supabase
        .from('licencas')
        .select('plano, vence_em, ativo')
        .eq('ativo', true)
        .gt('vence_em', agora),

      // Clientes criados por mês (últimos 6 meses)
      supabase
        .from('clientes')
        .select('criada_em')
        .gte('criada_em', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()),

      // Licenças criadas por mês (últimas 6 meses)
      supabase
        .from('licencas')
        .select('criada_em, plano')
        .gte('criada_em', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    // Distribuição por plano e receita
    const licencasAtivas = todasLicencasRes.data || [];
    const porPlano = { mensal: 0, semestral: 0, anual: 0 };
    let mrrEstimado = 0;
    let receitaTotal = 0;

    for (const lic of licencasAtivas) {
      const plano = lic.plano;
      if (porPlano[plano] !== undefined) porPlano[plano]++;
      // MRR: mensaliza receita
      if (plano === 'mensal') mrrEstimado += PRECOS.mensal;
      else if (plano === 'semestral') mrrEstimado += PRECOS.semestral / 6;
      else if (plano === 'anual') mrrEstimado += PRECOS.anual / 12;
    }

    // Receita total histórica (todas as licenças pagas)
    const { data: todasParaReceita } = await supabase
      .from('licencas')
      .select('plano')
      .not('pagamento_id', 'is', null);
    for (const lic of (todasParaReceita || [])) {
      receitaTotal += PRECOS[lic.plano] || 0;
    }

    // Agrupa por mês
    function agruparPorMes(registros, campo = 'criada_em') {
      const mapa = {};
      for (const r of (registros || [])) {
        const data = new Date(r[campo]);
        const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
        mapa[chave] = (mapa[chave] || 0) + 1;
      }
      // Garante últimos 6 meses (mesmo com 0)
      const resultado = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        resultado.push({ mes: chave, total: mapa[chave] || 0 });
      }
      return resultado;
    }

    res.json({
      total_clientes: totalClientesRes.count || 0,
      licencas_ativas: licencasAtivasRes.count || 0,
      licencas_expiradas: licencasExpiradasRes.count || 0,
      vencendo_7_dias: vencendo7Res.count || 0,
      mrr_estimado: parseFloat(mrrEstimado.toFixed(2)),
      receita_total: parseFloat(receitaTotal.toFixed(2)),
      por_plano: porPlano,
      novos_clientes_mes: agruparPorMes(clientesMesRes.data),
      novas_licencas_mes: agruparPorMes(licencasMesRes.data),
    });
  } catch (erro) {
    logger.error('Erro ao buscar métricas admin', { erro: erro.message });
    res.status(500).json({ erro: 'Erro interno ao buscar métricas' });
  }
});

// ── GET /admin/licencas?page=1&limit=20 ────────────────────────────────────
router.get('/licencas', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const agora = new Date().toISOString();

    const { data, count, error } = await supabase
      .from('licencas')
      .select(`
        id,
        codigo,
        plano,
        vence_em,
        ativo,
        criada_em,
        pagamento_id,
        clientes ( email )
      `, { count: 'exact' })
      .order('criada_em', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Enriquece com status calculado
    const em7Dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const licencas = (data || []).map(lic => {
      let status;
      if (!lic.ativo || lic.vence_em < agora) status = 'expirada';
      else if (lic.vence_em < em7Dias) status = 'vencendo';
      else status = 'ativa';

      return {
        id: lic.id,
        codigo: lic.codigo,
        email: lic.clientes?.email || '—',
        plano: lic.plano,
        criada_em: lic.criada_em,
        vence_em: lic.vence_em,
        status,
      };
    });

    res.json({
      licencas,
      total: count || 0,
      page,
      limit,
      total_paginas: Math.ceil((count || 0) / limit),
    });
  } catch (erro) {
    logger.error('Erro ao listar licenças admin', { erro: erro.message });
    res.status(500).json({ erro: 'Erro interno ao listar licenças' });
  }
});

module.exports = router;
