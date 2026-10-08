// Tarefas periódicas: expiração de subscrições e licenças, avisos de renovação, encomendas caducadas, limpeza.
import { getSetting, mail } from './core.js';
import { licEvent } from './licensing.js';

export function runJobs(ctx) {
  const db = ctx.db, now = ctx.now(), L = getSetting(ctx, 'licensing'), grace = (L.graceDays || 0) * 864e5;
  const out = { expired: 0, reminders: 0, ordersExpired: 0 };
  // fim do período pago (+ tolerância): a subscrição e a licença expiram — cancelar a renovação NÃO revoga antes disto
  for (const s of db.all("SELECT * FROM subscriptions WHERE status IN ('active','past_due','cancelled') AND current_period_end IS NOT NULL AND current_period_end + ? < ?", grace, now)) {
    db.run("UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ?", now, s.id);
    const lic = db.get("SELECT * FROM licenses WHERE subscription_id = ? AND status = 'active'", s.id);
    if (lic) { db.run("UPDATE licenses SET status = 'expired', status_reason = 'Fim do período pago' WHERE id = ?", lic.id); licEvent(ctx, lic.id, 'sistema', 'expired', 'Fim do período pago'); }
    out.expired++;
  }
  // licenças de demonstração / oferta com validade
  for (const l of db.all("SELECT * FROM licenses WHERE status = 'active' AND subscription_id IS NULL AND expires_at IS NOT NULL AND expires_at + ? < ?", grace, now)) {
    db.run("UPDATE licenses SET status = 'expired', status_reason = 'Validade terminada' WHERE id = ?", l.id); licEvent(ctx, l.id, 'sistema', 'expired', 'Validade terminada'); out.expired++;
  }
  // aviso 7 dias antes do fim do período (uma vez por período)
  for (const s of db.all("SELECT * FROM subscriptions WHERE status IN ('active','past_due') AND current_period_end BETWEEN ? AND ? AND (reminder_for IS NULL OR reminder_for != current_period_end)", now, now + 7 * 864e5)) {
    const u = db.get('SELECT * FROM users WHERE id = ?', s.user_id), plan = db.get('SELECT * FROM plans WHERE id = ?', s.plan_id);
    const action = s.cancel_at_period_end ? 'A renovação está cancelada: o acesso termina nessa data.' : s.auto_renew ? 'Será renovada automaticamente pelo método de pagamento associado.' : 'Esta subscrição é paga por transferência: renova-a na área de cliente antes dessa data.';
    mail(ctx, u.email, 'renewal_reminder', { name: u.name, plan: plan.name, date: new Date(s.current_period_end).toLocaleDateString('pt-PT'), action, link: ctx.cfg.publicUrl + '/conta#subscricoes' });
    db.run('UPDATE subscriptions SET reminder_for = current_period_end WHERE id = ?', s.id);
    out.reminders++;
  }
  // encomendas por transferência sem comprovativo depois do prazo; checkouts online abandonados (48 h)
  out.ordersExpired += db.run("UPDATE orders SET status = 'expired', updated_at = ? WHERE status = 'pending' AND method IN ('bank_pt','bank_ao') AND due_at < ? AND NOT EXISTS (SELECT 1 FROM proofs p WHERE p.order_id = orders.id AND p.status IN ('submitted','needs_info'))", now, now).changes;
  out.ordersExpired += db.run("UPDATE orders SET status = 'expired', updated_at = ? WHERE status = 'pending' AND method IN ('card','paypal','test') AND created_at < ?", now, now - 48 * 3600e3).changes;
  // limpeza
  db.run('DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?', now, now - 30 * 864e5);
  db.run('DELETE FROM login_attempts WHERE at < ?', now - 864e5);
  db.run('DELETE FROM tokens WHERE expires_at < ?', now - 7 * 864e5);
  return out;
}
