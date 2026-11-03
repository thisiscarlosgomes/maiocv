import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { analyticsAuthorized } from "../../lib/analytics-auth";
import { readAnalytics } from "../../lib/analytics-store";
import { ThemeSwitch } from "../../components/theme-switch";
import "./analytics.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics · maio.cv", robots: { index: false, follow: false } };
const number = (n: number) => new Intl.NumberFormat("pt-PT").format(n);
const pageNames: Record<string,string> = { "/": "Página inicial", "/chat": "Ask Maio", "/plan": "Planear viagem", "/search": "Explorar", "/essentials": "Essenciais", "/faq": "Sobre o projeto", "/sources": "Fontes", "/privacy": "Privacidade", "/terms": "Termos" };
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  if (!analyticsAuthorized((await headers()).get("authorization"))) notFound();
  const requested = (await searchParams).days;
  const days = requested === "7" ? 7 : requested === "90" ? 90 : 30;
  const data = await readAnalytics(days).catch(() => null);
  const total = data?.totals.pageview ?? 0;
  const peak = Math.max(1, ...data?.daily.map(d => d.views) ?? []);
  const cards = [
    { label: "Visualizações", value: data?.totals.pageview, note: "Páginas abertas", icon: "↗" },
    { label: "Respostas no chat", value: data?.totals.chat_answer, note: "Respostas apresentadas", icon: "↳" },
    { label: "Chamadas ligadas", value: data?.totals.voice_connected, note: "Ligações de voz iniciadas", icon: "◉" },
    { label: "Planos gerados", value: data?.totals.plan_generated, note: "Pedidos de planeamento concluídos", icon: "▦" },
  ];
  return <div className="analytics-shell">
    <header className="analytics-top"><Link href="/pt" className="analytics-brand">maio.cv <span>/ Analytics</span></Link><div><span className="analytics-private">Área privada</span><ThemeSwitch locale="pt" /></div></header>
    <main>
      <div className="analytics-heading"><div><p className="analytics-eyebrow">VISÃO GERAL</p><h1>A ilha, em números.</h1><p>Acompanhe como as pessoas exploram o Maio e usam as suas ferramentas.</p></div>
      <nav aria-label="Período" className="analytics-period">{[7,30,90].map(n => <Link key={n} href={`/pt/analytics?days=${n}`} aria-current={days===n ? "page" : undefined}>{n} dias</Link>)}</nav></div>
      <div className="analytics-status"><span className={data ? "analytics-dot" : "analytics-dot offline"} /><span>{data ? data.firstSeenAt ? `Dados desde ${new Date(data.firstSeenAt).toLocaleDateString("pt-PT", { timeZone: "UTC" })}` : "Pronto para receber as primeiras visitas" : "Não foi possível carregar os dados. Verifique a ligação e tente novamente."}</span><span className="analytics-zone">Dias em UTC · inclui hoje</span></div>
      <section className="analytics-cards" aria-label="Métricas principais">{cards.map(card => <article key={card.label} className="analytics-card"><div><h2>{card.label}</h2><span aria-hidden="true">{card.icon}</span></div><strong>{card.value === undefined ? "—" : number(card.value)}</strong><p>{card.note}</p></article>)}</section>
      <section className="analytics-panel analytics-trend"><div className="analytics-panel-heading"><div><h2>Visitas ao longo do tempo</h2><p>Visualizações por dia · últimos {days} dias</p></div><span className="analytics-legend"><i /> Visualizações</span></div>
        {!data ? <p className="analytics-empty">Dados temporariamente indisponíveis.</p> : total === 0 ? <div className="analytics-empty"><span aria-hidden="true">↗</span><h3>A primeira visita começa esta história.</h3><p>Os dados aparecem aqui quando o site recebe visitas. Não existe histórico anterior à instalação.</p></div> : <><div className="analytics-chart" role="img" aria-label={`Visualizações diárias nos últimos ${days} dias. Total: ${total}. Dados detalhados na tabela abaixo.`}>{data.daily.map(d => <div key={d.day} title={`${d.day}: ${number(d.views)} visualizações`}><span style={{ height: d.views ? `${Math.max(2,d.views/peak*100)}%` : "0" }} /></div>)}</div><div className="analytics-axis"><span>{data.daily[0].day}</span><span>{data.daily.at(-1)?.day}</span></div><details className="analytics-table-detail"><summary>Ver valores diários</summary><div className="analytics-table-scroll"><table><thead><tr><th>Data (UTC)</th><th>Visualizações</th><th>Ações</th></tr></thead><tbody>{data.daily.map(d => <tr key={d.day}><td>{d.day}</td><td>{number(d.views)}</td><td>{number(d.actions)}</td></tr>)}</tbody></table></div></details></>}
      </section>
      <div className="analytics-bottom"><section className="analytics-panel"><div className="analytics-panel-heading"><div><h2>Páginas mais vistas</h2><p>Onde começa a descoberta</p></div></div>{data?.pages.length ? <ol className="analytics-ranks">{data.pages.map(([page,count],i) => <li key={page}><span className="analytics-rank">{String(i+1).padStart(2,"0")}</span><div><strong>{pageNames[page] ?? page}</strong><small>{page}</small></div><span>{number(count)}</span><span className="analytics-share">{Math.round(count/total*100)}%</span></li>)}</ol> : <p className="analytics-empty">{data ? "Ainda sem visualizações neste período." : "Dados indisponíveis."}</p>}</section>
      <section className="analytics-panel"><div className="analytics-panel-heading"><div><h2>Idiomas</h2><p>Idioma da página visitada</p></div></div>{data?.languages.length ? <ul className="analytics-languages">{data.languages.map(([locale,count]) => <li key={locale}><div><strong>{({pt:"Português",en:"English",fr:"Français"} as Record<string,string>)[locale] ?? locale}</strong><span>{number(count)}</span></div><meter min={0} max={total} value={count}>{count} / {total}</meter></li>)}</ul> : <p className="analytics-empty">{data ? "Os idiomas aparecem com as primeiras visitas." : "Dados indisponíveis."}</p>}</section></div>
      <footer className="analytics-foot"><p>Contagens agregadas, sem identificar visitantes nem guardar perguntas, respostas ou gravações. Não representam utilizadores únicos. Pedidos automáticos e bloqueadores podem afetar os totais. Retenção: 90 dias.</p><a href="https://vercel.com/forkctokcs-projects/maiocv/analytics" target="_blank" rel="noopener noreferrer">Abrir Vercel Web Analytics ↗</a></footer>
    </main>
  </div>;
}
