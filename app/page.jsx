"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================
// O JUIZ v2 — avaliador de debates com IA
// Dois eixos independentes:
//   • DEBATE  → quem argumentou melhor (retórica)
//   • VERDADE → quem está mais perto do que é fato (crença)
// ============================================================

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&family=Spectral:ital,wght@0,300;0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap');
`;

const C = {
  bg: "#0F0E0C", panel: "#17150F", panel2: "#1E1B14", line: "#332E22",
  ink: "#EDE8DF", dim: "#9A9384", red: "#C8302A", redDim: "#7a2420",
  gold: "#C9A24B", green: "#6FAE6B", cyan: "#5BB3C8",
};

const DEBATE_CRIT = [
  { k: "logica", label: "Lógica" },
  { k: "persuasao", label: "Persuasão" },
  { k: "resposta", label: "Resposta ao oponente" },
  { k: "clareza", label: "Clareza" },
  { k: "limpeza", label: "Jogo limpo" },
];
const VERDADE_CRIT = [
  { k: "correcao", label: "Correção factual" },
  { k: "evidencia", label: "Evidência" },
  { k: "validade", label: "Validade lógica" },
  { k: "calibracao", label: "Calibração" },
  { k: "realidade", label: "Proximidade da realidade" },
];

const STORE_KEY = "ojuiz:historico:v2";

function isTieName(n) { return n === "empate" || n === "indecidível"; }

export default function App() {
  const [input, setInput] = useState("");
  const [isWhats, setIsWhats] = useState(false);
  const [tone, setTone] = useState("justo");
  const [factCheck, setFactCheck] = useState(false);
  const [mode, setMode] = useState("ambos"); // ambos | debate | verdade
  const [loading, setLoading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [view, setView] = useState("juiz");
  const [history, setHistory] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch (e) {}
  }, []);

  const persist = useCallback((next) => {
    setHistory(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next.slice(0, 50))); }
    catch (e) { console.error(e); }
  }, []);

  const ranking = (() => {
    const m = {};
    const bump = (nome) => (m[nome] = m[nome] || { nome, vd: 0, vt: 0, total: 0 });
    for (const h of history) {
      for (const p of h.participantes || []) { bump(p); m[p].total++; }
      if (h.vencedor_debate && !isTieName(h.vencedor_debate)) { bump(h.vencedor_debate).vd++; }
      if (h.vencedor_verdade && !isTieName(h.vencedor_verdade)) { bump(h.vencedor_verdade).vt++; }
    }
    return Object.values(m).sort((a, b) => (b.vd + b.vt) - (a.vd + a.vt) || a.total - b.total);
  })();

  // ---------- IMPORT DE PRINT ----------
  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError(""); setTranscribing(true);
    try {
      const images = await Promise.all(files.map(toImagePart));
      const resp = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Falha ao transcrever o print.");
      const text = data.text;
      if (!text) throw new Error("Não consegui ler o print.");
      setInput((prev) => (prev.trim() ? prev.trim() + "\n" + text : text));
    } catch (err) {
      setError(err.message || "Falha ao transcrever o print.");
    } finally {
      setTranscribing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function toImagePart(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res({ type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data: r.result.split(",")[1] } });
      r.onerror = () => rej(new Error("Erro lendo arquivo"));
      r.readAsDataURL(file);
    });
  }

  // ---------- JULGAMENTO ----------
  function buildPrompt() {
    const toneTxt = tone === "brutal"
      ? "Tom BRUTAL: ácido, direto, sem diplomacia. Expõe cada furo sem dó — mas só com base no texto, sem inventar."
      : "Tom JUSTO: equilibrado e rigoroso, crítico onde precisa, justo onde merece.";
    const whatsTxt = isWhats
      ? "O texto é export de WhatsApp. Ignore timestamps, '<Mídia oculta>' e ruído. Identifique participantes pelos nomes."
      : "Identifique cada participante pelos nomes/marcadores no texto.";
    const fcTxt = factCheck
      ? "FACT-CHECK ATIVO: cheque as principais alegações factuais com busca na web e preencha fact_checks."
      : "Sem fact-check: fact_checks = [].";

    const wantDebate = mode === "ambos" || mode === "debate";
    const wantVerdade = mode === "ambos" || mode === "verdade";

    const debateBlock = `"debate": {
    "placar":[{"nome":"X","criterios":{"logica":0-10,"persuasao":0-10,"resposta":0-10,"clareza":0-10,"limpeza":0-10}}],
    "vencedor":"nome | empate",
    "margem":"folgada | apertada | empate",
    "veredicto":"quem argumentou melhor e por quê (SÓ retórica, ignore quem está factualmente certo)"
  }`;
    const verdadeBlock = `"verdade": {
    "placar":[{"nome":"X","criterios":{"correcao":0-10,"evidencia":0-10,"validade":0-10,"calibracao":0-10,"realidade":0-10}}],
    "vencedor":"nome | empate | indecidível",
    "margem":"folgada | apertada | empate",
    "qual_e_a_verdade":"o que de fato é mais provável ser verdade sobre a questão de fundo, independente de quem falou",
    "veredicto":"quem está mais perto da verdade e por quê (IGNORE quem se expressou melhor — vale a substância)"
  }`;

    return `Você é O JUIZ: árbitro de debates implacável e imparcial. Avalie a conversa em DOIS EIXOS SEPARADOS E INDEPENDENTES:

1) DEBATE (retórica): quem argumentou melhor — lógica, persuasão, se respondeu de fato ao oponente, clareza, jogo limpo. NÃO importa quem está certo.
2) VERDADE (fato): quem está mais perto do que é de fato verdade — correção factual, evidência, validade lógica, calibração (admite incerteza?), proximidade da realidade. NÃO importa quem fala melhor. Forme um juízo próprio sobre a questão de fundo: alguém pode estar CERTO e ter se expressado MAL, e vice-versa.

${whatsTxt}
${toneTxt}
${fcTxt}

REGRAS:
- Avalie só o que está no texto; não invente posições.
- Steelman primeiro: reformule o melhor argumento de cada lado antes de julgar.
- Falácias com NOME técnico (ad hominem, espantalho, falso dilema, whataphobia/whataboutism, generalização apressada, petição de princípio, apelo à autoridade etc.), CITAÇÃO literal e explicação.
- Reconheça onde cada um tem razão, mesmo o perdedor.
- Se a questão de fundo for puro valor/opinião sem fato decidível, em verdade.vencedor use "indecidível".
- Em trechos_destacados, copie a CITAÇÃO LITERAL exata do texto (palavra por palavra), pra eu conseguir destacá-la na transcrição.
${mode === "ambos" ? '- Preencha "divergencia" se os vencedores de debate e verdade forem pessoas diferentes; senão null.' : ""}

Responda APENAS JSON válido, sem markdown nem cercas, neste formato:
{
  "tema":"1 frase",
  "participantes":["Nome1","Nome2"],
  "resumo":"2-3 frases neutras",
  "questao_de_fato": true,
  "steelman":[{"nome":"Nome1","melhor_argumento":"..."}],
  "analise":[{
    "nome":"Nome1",
    "falacias":[{"tipo":"Ad hominem","citacao":"trecho literal","explicacao":"..."}],
    "pontos_fortes":["..."],
    "onde_tem_razao":["..."],
    "onde_erra":["..."],
    "trechos_destacados":[{"citacao":"trecho literal exato do texto","tipo":"falacia|forte","rotulo":"curtinho, ex: Espantalho / Bom ponto"}]
  }],
  ${wantDebate ? debateBlock + "," : ""}
  ${wantVerdade ? verdadeBlock + "," : ""}
  ${mode === "ambos" ? '"divergencia":"texto ou null",' : ""}
  "fact_checks":[{"alegacao":"...","autor":"Nome1","veredicto":"verdadeiro|falso|impreciso|inverificavel","explicacao":"..."}],
  "nota_final":"1 frase de tabefe final"
}

CONVERSA:
"""
${input.trim()}
"""`;
  }

  async function judge() {
    setError("");
    if (input.trim().length < 20) { setError("Cola uma conversa de verdade — tá curto demais."); return; }
    setLoading(true); setResult(null);
    try {
      const resp = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildPrompt(), factCheck }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Deu ruim na chamada. Tenta de novo.");
      const json = data.result;
      if (!json) throw new Error("Não consegui interpretar o veredicto. Tenta de novo.");
      json._source = input.trim();
      json._mode = mode;
      setResult(json);
      persist([{
        id: Date.now(),
        data: new Date().toISOString(),
        tema: json.tema,
        participantes: json.participantes || [],
        vencedor_debate: json.debate?.vencedor || null,
        vencedor_verdade: json.verdade?.vencedor || null,
        nota_final: json.nota_final,
        full: json,
      }, ...history]);
    } catch (e) {
      setError(e.message || "Deu ruim. Tenta de novo.");
    } finally { setLoading(false); }
  }

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: "100%", fontFamily: "'Spectral', serif" }}>
      <style>{FONTS}{styleSheet}</style>
      <div className="oj-wrap">
        <header className="oj-head">
          <div>
            <div className="oj-kicker">TRIBUNAL DA RAZÃO · v2</div>
            <h1 className="oj-title">O JUIZ</h1>
            <p className="oj-sub">Dois veredictos: quem <b>debateu melhor</b> e quem está <b>mais perto da verdade</b>. Quase nunca é o mesmo.</p>
          </div>
          <nav className="oj-nav">
            <button className={view === "juiz" ? "on" : ""} onClick={() => setView("juiz")}>Julgar</button>
            <button className={view === "historico" ? "on" : ""} onClick={() => setView("historico")}>
              Histórico {history.length ? `(${history.length})` : ""}
            </button>
          </nav>
        </header>

        {view === "juiz" && !result && (
          <section className="oj-panel">
            <textarea className="oj-text"
              placeholder={isWhats ? "Cola o export do WhatsApp…" : "Cola a conversa:\n\nVocê: acho X porque Y\nFulano: discordo, na verdade Z\n…"}
              value={input} onChange={(e) => setInput(e.target.value)} />

            <div className="oj-import">
              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onFiles} />
              <button className="oj-attach" onClick={() => fileRef.current?.click()} disabled={transcribing}>
                {transcribing ? "Lendo print…" : "📎 Transcrever print(s)"}
              </button>
              {input && <button className="oj-attach ghost" onClick={() => setInput("")}>limpar</button>}
            </div>

            <div className="oj-modebar">
              <span className="oj-lbl">Veredicto</span>
              <button className={mode === "ambos" ? "seg on" : "seg"} onClick={() => setMode("ambos")}>Ambos</button>
              <button className={mode === "debate" ? "seg on" : "seg"} onClick={() => setMode("debate")}>Só debate</button>
              <button className={mode === "verdade" ? "seg on" : "seg"} onClick={() => setMode("verdade")}>Só verdade</button>
            </div>

            <div className="oj-controls">
              <div className="oj-segment">
                <span className="oj-lbl">Tom</span>
                <button className={tone === "justo" ? "seg on" : "seg"} onClick={() => setTone("justo")}>Justo</button>
                <button className={tone === "brutal" ? "seg on" : "seg"} onClick={() => setTone("brutal")}>Brutal</button>
              </div>
              <label className="oj-toggle"><input type="checkbox" checked={isWhats} onChange={(e) => setIsWhats(e.target.checked)} /><span>Export WhatsApp</span></label>
              <label className="oj-toggle"><input type="checkbox" checked={factCheck} onChange={(e) => setFactCheck(e.target.checked)} /><span>Fact-check web {factCheck && <em>(+ lento)</em>}</span></label>
              <button className="oj-go" onClick={judge} disabled={loading}>{loading ? "Deliberando…" : "Bater o martelo"}</button>
            </div>

            {error && <div className="oj-err">{error}</div>}
            {loading && <div className="oj-loading"><span /><span /><span /> Lendo os autos…</div>}
          </section>
        )}

        {view === "juiz" && result && <Verdict r={result} onReset={() => { setResult(null); setError(""); }} />}

        {view === "historico" && (
          <HistoryView history={history} ranking={ranking}
            onOpen={(h) => { setResult(h.full); setView("juiz"); }}
            onClear={() => persist([])} />
        )}

        <footer className="oj-foot">Ferramenta pessoal · julgamentos são opinião de uma IA, não a Verdade™</footer>
      </div>
    </div>
  );
}

// ============================================================
function Verdict({ r, onReset }) {
  const hasDebate = !!r.debate, hasVerdade = !!r.verdade;
  const wd = r.debate?.vencedor, wt = r.verdade?.vencedor;
  const diverge = hasDebate && hasVerdade && !isTieName(wd) && !isTieName(wt) && wd !== wt;

  return (
    <section className="oj-verdict">
      <div className="oj-twin">
        {hasDebate && <WinBox kicker="VENCEU O DEBATE" sub="argumentou melhor" winner={wd} margem={r.debate.margem} color={C.cyan} />}
        {hasVerdade && <WinBox kicker="MAIS PERTO DA VERDADE" sub="tem mais razão de fato" winner={wt} margem={r.verdade.margem} color={C.gold} />}
      </div>

      {diverge && (
        <div className="oj-diverge">
          <b>Atenção:</b> os eixos divergem. <b style={{ color: C.cyan }}>{wd}</b> ganhou no discurso, mas <b style={{ color: C.gold }}>{wt}</b> está mais perto da verdade.
          {r.divergencia && <span> {r.divergencia}</span>}
        </div>
      )}

      <div className="oj-actions"><button className="oj-new" onClick={onReset}>Novo julgamento</button></div>

      {r.tema && <p className="oj-tema">{r.tema}</p>}
      {r.resumo && <p className="oj-resumo">{r.resumo}</p>}

      {hasDebate && <ScoreCard title="Placar — Debate (retórica)" placar={r.debate.placar} crit={DEBATE_CRIT} veredicto={r.debate.veredicto} accent={C.cyan} />}
      {hasVerdade && (
        <ScoreCard title="Placar — Verdade (fato)" placar={r.verdade.placar} crit={VERDADE_CRIT} veredicto={r.verdade.veredicto} accent={C.gold}
          extra={r.verdade.qual_e_a_verdade && <div className="oj-truth"><span>O que é, de fato:</span> {r.verdade.qual_e_a_verdade}</div>} />
      )}

      {r.steelman?.length > 0 && (
        <div className="oj-card">
          <h3>Melhor argumento de cada lado <small>(steelman)</small></h3>
          {r.steelman.map((s, i) => <div className="oj-steel" key={i}><b>{s.nome}</b><p>{s.melhor_argumento}</p></div>)}
        </div>
      )}

      {r._source && <Annotated source={r._source} analise={r.analise} />}

      <div className="oj-grid2">
        {(r.analise || []).map((a, i) => (
          <div className="oj-card person" key={i}>
            <h3>{a.nome}</h3>
            {a.falacias?.length > 0 && (
              <div className="oj-block">
                <div className="oj-block-h fail">Falácias / furos</div>
                {a.falacias.map((f, j) => (
                  <div className="oj-fallacy" key={j}>
                    <div className="oj-ftype">{f.tipo}</div>
                    {f.citacao && <blockquote>&quot;{f.citacao}&quot;</blockquote>}
                    <p>{f.explicacao}</p>
                  </div>
                ))}
              </div>
            )}
            {a.pontos_fortes?.length > 0 && <Lst title="Pontos fortes" items={a.pontos_fortes} kind="good" />}
            {a.onde_tem_razao?.length > 0 && <Lst title="Onde tem razão" items={a.onde_tem_razao} kind="good" />}
            {a.onde_erra?.length > 0 && <Lst title="Onde erra" items={a.onde_erra} kind="fail" />}
          </div>
        ))}
      </div>

      {r.fact_checks?.length > 0 && (
        <div className="oj-card">
          <h3>Fact-check</h3>
          {r.fact_checks.map((f, i) => (
            <div className="oj-fc" key={i}>
              <span className={`oj-fc-tag ${f.veredicto}`}>{f.veredicto}</span>
              <div>
                <p className="oj-fc-claim">&quot;{f.alegacao}&quot; <em>— {f.autor}</em></p>
                <p className="oj-fc-exp">{f.explicacao}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {r.nota_final && <div className="oj-card final"><p className="oj-punch">&quot;{r.nota_final}&quot;</p></div>}
    </section>
  );
}

function WinBox({ kicker, sub, winner, margem, color }) {
  const tie = isTieName(winner);
  return (
    <div className="oj-winbox" style={{ borderTopColor: color }}>
      <div className="oj-wb-k" style={{ color }}>{kicker}</div>
      <div className={"oj-wb-name" + (tie ? " tie" : "")}>{tie ? (winner === "indecidível" ? "Indecidível" : "Empate") : winner}</div>
      <div className="oj-wb-sub">{tie ? "sem vencedor claro" : sub}{margem && !tie ? ` · margem ${margem}` : ""}</div>
    </div>
  );
}

function ScoreCard({ title, placar, crit, veredicto, accent, extra }) {
  const totals = (placar || []).map((p) => ({
    nome: p.nome, criterios: p.criterios || {},
    total: crit.reduce((s, c) => s + (Number(p.criterios?.[c.k]) || 0), 0),
  }));
  const max = Math.max(...totals.map((t) => t.total), 1);
  return (
    <div className="oj-card">
      <h3 style={{ color: accent }}>{title}</h3>
      {totals.map((t) => (
        <div className="oj-score-row" key={t.nome}>
          <div className="oj-score-name">{t.nome} <b style={{ color: accent }}>{t.total}<small>/50</small></b></div>
          <div className="oj-bar"><div className="oj-bar-fill" style={{ width: `${(t.total / max) * 100}%`, background: t.total === max ? accent : C.redDim }} /></div>
          <div className="oj-crit-grid">
            {crit.map((c) => <div className="oj-crit" key={c.k}><span>{c.label}</span><b>{t.criterios[c.k] ?? "–"}</b></div>)}
          </div>
        </div>
      ))}
      {extra}
      {veredicto && <p className="oj-verd-text">{veredicto}</p>}
    </div>
  );
}

function Lst({ title, items, kind }) {
  return (
    <div className="oj-block">
      <div className={`oj-block-h ${kind}`}>{title}</div>
      <ul className="oj-list">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
  );
}

function Annotated({ source, analise }) {
  const marks = [];
  for (const a of analise || []) {
    for (const t of a.trechos_destacados || []) {
      if (t.citacao && t.citacao.trim().length > 3) marks.push({ cite: t.citacao.trim(), tipo: t.tipo, rotulo: t.rotulo, nome: a.nome });
    }
  }
  if (!marks.length) return null;

  const lower = source.toLowerCase();
  const ranges = [];
  for (const m of marks) {
    const idx = lower.indexOf(m.cite.toLowerCase());
    if (idx === -1) continue;
    ranges.push({ start: idx, end: idx + m.cite.length, m });
  }
  ranges.sort((a, b) => a.start - b.start);
  const clean = [];
  let lastEnd = -1;
  for (const r of ranges) { if (r.start >= lastEnd) { clean.push(r); lastEnd = r.end; } }

  if (!clean.length) return null;

  const nodes = [];
  let cur = 0;
  clean.forEach((r, i) => {
    if (r.start > cur) nodes.push(<span key={`t${i}`}>{source.slice(cur, r.start)}</span>);
    nodes.push(
      <mark key={`m${i}`} className={`oj-mark ${r.m.tipo === "falacia" ? "fal" : "forte"}`} title={`${r.m.nome} — ${r.m.rotulo || r.m.tipo}`}>
        {source.slice(r.start, r.end)}
        {r.m.rotulo && <sup className="oj-mark-tag">{r.m.rotulo}</sup>}
      </mark>
    );
    cur = r.end;
  });
  if (cur < source.length) nodes.push(<span key="tend">{source.slice(cur)}</span>);

  return (
    <div className="oj-card">
      <h3>Transcrição anotada</h3>
      <div className="oj-legend">
        <span><i className="dot fal" /> falácia / furo</span>
        <span><i className="dot forte" /> ponto forte</span>
      </div>
      <div className="oj-annot">{nodes}</div>
    </div>
  );
}

// ============================================================
function HistoryView({ history, ranking, onOpen, onClear }) {
  if (!history.length)
    return <section className="oj-panel"><p className="oj-empty">Nenhum julgamento ainda. Bate o primeiro martelo.</p></section>;
  return (
    <section className="oj-hist">
      {ranking.length > 0 && (
        <div className="oj-card">
          <h3>Ranking acumulado</h3>
          <div className="oj-rank-head"><span /><span>Nome</span><span style={{ color: C.cyan }}>Debate</span><span style={{ color: C.gold }}>Verdade</span></div>
          {ranking.map((p, i) => (
            <div className="oj-rank-row" key={p.nome}>
              <span className="oj-rank-pos">{i + 1}</span>
              <span className="oj-rank-name">{p.nome}</span>
              <span className="oj-rank-v" style={{ color: C.cyan }}>{p.vd}</span>
              <span className="oj-rank-v" style={{ color: C.gold }}>{p.vt}</span>
            </div>
          ))}
        </div>
      )}
      <div className="oj-card">
        <div className="oj-hist-head"><h3>Julgamentos</h3><button className="oj-clear" onClick={onClear}>limpar tudo</button></div>
        {history.map((h) => (
          <button className="oj-hist-row" key={h.id} onClick={() => onOpen(h)}>
            <div>
              <div className="oj-hist-tema">{h.tema || "(sem tema)"}</div>
              <div className="oj-hist-meta">{(h.participantes || []).join(" × ")} · {new Date(h.data).toLocaleDateString("pt-BR")}</div>
            </div>
            <div className="oj-hist-wins">
              {h.vencedor_debate && <span className="tag cyan">D: {isTieName(h.vencedor_debate) ? "—" : h.vencedor_debate}</span>}
              {h.vencedor_verdade && <span className="tag gold">V: {isTieName(h.vencedor_verdade) ? "—" : h.vencedor_verdade}</span>}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ============================================================
const styleSheet = `
* { box-sizing:border-box; }
.oj-wrap { max-width:880px; margin:0 auto; padding:28px 20px 60px; }
.oj-head { display:flex; justify-content:space-between; align-items:flex-end; gap:20px; border-bottom:1px solid ${C.line}; padding-bottom:20px; margin-bottom:24px; flex-wrap:wrap; }
.oj-kicker { font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:3px; color:${C.red}; margin-bottom:6px; }
.oj-title { font-family:'Oswald',sans-serif; font-weight:700; font-size:54px; line-height:.9; letter-spacing:-1px; margin:0; text-transform:uppercase; }
.oj-sub { color:${C.dim}; font-size:15px; margin:8px 0 0; max-width:480px; } .oj-sub b { color:${C.ink}; font-weight:600; }
.oj-nav { display:flex; gap:4px; }
.oj-nav button { background:transparent; border:1px solid ${C.line}; color:${C.dim}; font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:1px; padding:8px 14px; cursor:pointer; text-transform:uppercase; transition:.15s; }
.oj-nav button:hover { color:${C.ink}; border-color:${C.dim}; }
.oj-nav button.on { background:${C.ink}; color:${C.bg}; border-color:${C.ink}; }

.oj-panel { background:${C.panel}; border:1px solid ${C.line}; padding:22px; }
.oj-text { width:100%; min-height:230px; background:${C.bg}; border:1px solid ${C.line}; color:${C.ink}; font-family:'JetBrains Mono',monospace; font-size:13px; line-height:1.6; padding:16px; resize:vertical; outline:none; }
.oj-text:focus { border-color:${C.gold}; } .oj-text::placeholder { color:#5b5648; }

.oj-import { display:flex; gap:8px; margin-top:10px; }
.oj-attach { background:transparent; border:1px dashed ${C.line}; color:${C.dim}; padding:8px 14px; font-family:'JetBrains Mono',monospace; font-size:12px; cursor:pointer; transition:.15s; }
.oj-attach:hover:not(:disabled) { color:${C.ink}; border-color:${C.gold}; } .oj-attach:disabled { opacity:.5; cursor:wait; }
.oj-attach.ghost { border-style:solid; }

.oj-modebar { display:flex; align-items:center; gap:6px; margin-top:16px; padding-bottom:14px; border-bottom:1px solid ${C.line}; }
.oj-controls { display:flex; align-items:center; gap:18px; margin-top:14px; flex-wrap:wrap; }
.oj-segment { display:flex; align-items:center; gap:6px; }
.oj-lbl { font-family:'JetBrains Mono',monospace; font-size:11px; color:${C.dim}; letter-spacing:1px; }
.seg { background:transparent; border:1px solid ${C.line}; color:${C.dim}; padding:6px 12px; font-family:'Oswald',sans-serif; text-transform:uppercase; font-size:12px; letter-spacing:1px; cursor:pointer; }
.seg.on { background:${C.red}; border-color:${C.red}; color:#fff; }
.oj-toggle { display:flex; align-items:center; gap:7px; color:${C.dim}; font-size:13px; cursor:pointer; }
.oj-toggle input { accent-color:${C.red}; width:15px; height:15px; } .oj-toggle em { color:${C.gold}; font-style:italic; font-size:11px; }
.oj-go { margin-left:auto; background:${C.red}; color:#fff; border:none; font-family:'Oswald',sans-serif; font-weight:600; font-size:16px; letter-spacing:2px; text-transform:uppercase; padding:13px 26px; cursor:pointer; transition:.15s; }
.oj-go:hover:not(:disabled) { background:#e0392f; } .oj-go:disabled { opacity:.55; cursor:wait; }

.oj-err { margin-top:14px; color:${C.red}; font-family:'JetBrains Mono',monospace; font-size:13px; border-left:2px solid ${C.red}; padding-left:12px; }
.oj-loading { margin-top:18px; color:${C.dim}; font-family:'JetBrains Mono',monospace; font-size:13px; display:flex; align-items:center; gap:5px; }
.oj-loading span { width:6px; height:6px; background:${C.red}; border-radius:50%; display:inline-block; animation:oj-b 1s infinite; }
.oj-loading span:nth-child(2){animation-delay:.2s} .oj-loading span:nth-child(3){animation-delay:.4s; margin-right:8px;}
@keyframes oj-b { 0%,100%{opacity:.25;transform:translateY(0)} 50%{opacity:1;transform:translateY(-4px)} }

.oj-verdict { animation:oj-fade .4s ease; } @keyframes oj-fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }

.oj-twin { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
@media(max-width:680px){ .oj-twin{grid-template-columns:1fr} .oj-grid2{grid-template-columns:1fr!important} }
.oj-winbox { background:linear-gradient(135deg,${C.panel2},${C.panel}); border:1px solid ${C.line}; border-top:4px solid; padding:18px 20px; }
.oj-wb-k { font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:2px; margin-bottom:8px; }
.oj-wb-name { font-family:'Oswald',sans-serif; font-weight:700; font-size:30px; text-transform:uppercase; line-height:1; }
.oj-wb-name.tie { color:${C.dim}; font-size:24px; }
.oj-wb-sub { color:${C.dim}; font-size:12px; margin-top:6px; }
.oj-diverge { background:${C.panel}; border-left:3px solid ${C.gold}; padding:13px 16px; margin-top:14px; font-size:14px; line-height:1.6; color:${C.ink}; }
.oj-actions { margin-top:14px; }
.oj-new { background:transparent; border:1px solid ${C.line}; color:${C.dim}; padding:8px 14px; font-family:'JetBrains Mono',monospace; font-size:11px; cursor:pointer; text-transform:uppercase; }
.oj-new:hover { color:${C.ink}; border-color:${C.dim}; }

.oj-tema { font-size:19px; font-weight:600; margin:22px 0 4px; }
.oj-resumo { color:${C.dim}; font-size:15px; margin:0 0 22px; line-height:1.6; }

.oj-card { background:${C.panel}; border:1px solid ${C.line}; padding:20px 22px; margin-bottom:16px; }
.oj-card h3 { font-family:'Oswald',sans-serif; font-weight:600; font-size:14px; letter-spacing:2px; text-transform:uppercase; margin:0 0 16px; color:${C.gold}; }
.oj-card h3 small { color:${C.dim}; font-weight:300; text-transform:none; letter-spacing:0; }
.oj-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }

.oj-score-row { margin-bottom:18px; }
.oj-score-name { font-family:'Oswald',sans-serif; font-size:18px; text-transform:uppercase; letter-spacing:.5px; margin-bottom:6px; }
.oj-score-name small { color:${C.dim}; font-size:11px; }
.oj-bar { height:8px; background:${C.bg}; border:1px solid ${C.line}; overflow:hidden; }
.oj-bar-fill { height:100%; transition:width .6s ease; }
.oj-crit-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:6px 14px; margin-top:10px; }
.oj-crit { display:flex; justify-content:space-between; font-size:12px; color:${C.dim}; border-bottom:1px dotted ${C.line}; padding-bottom:3px; }
.oj-crit b { color:${C.ink}; font-family:'JetBrains Mono',monospace; }
.oj-verd-text { font-size:14.5px; line-height:1.65; color:${C.ink}; margin:14px 0 0; padding-top:14px; border-top:1px solid ${C.line}; }
.oj-truth { background:${C.bg}; border:1px solid ${C.line}; padding:12px 14px; margin-top:6px; font-size:14px; line-height:1.6; }
.oj-truth span { font-family:'JetBrains Mono',monospace; font-size:11px; color:${C.gold}; text-transform:uppercase; letter-spacing:1px; display:block; margin-bottom:4px; }

.oj-steel { margin-bottom:12px; }
.oj-steel b { font-family:'Oswald',sans-serif; text-transform:uppercase; font-size:14px; letter-spacing:1px; }
.oj-steel p { margin:3px 0 0; color:${C.dim}; font-size:14px; line-height:1.55; }

.oj-legend { display:flex; gap:18px; margin-bottom:12px; font-size:12px; color:${C.dim}; }
.oj-legend .dot { display:inline-block; width:10px; height:10px; margin-right:5px; vertical-align:middle; }
.dot.fal { background:${C.redDim}; } .dot.forte { background:${C.green}; }
.oj-annot { font-family:'JetBrains Mono',monospace; font-size:13px; line-height:2; white-space:pre-wrap; word-break:break-word; }
.oj-mark { padding:1px 2px; border-radius:2px; position:relative; }
.oj-mark.fal { background:rgba(200,48,42,.22); color:${C.ink}; box-shadow:inset 0 -2px 0 ${C.red}; }
.oj-mark.forte { background:rgba(111,174,107,.18); color:${C.ink}; box-shadow:inset 0 -2px 0 ${C.green}; }
.oj-mark-tag { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:.5px; text-transform:uppercase; margin-left:3px; opacity:.8; vertical-align:super; }
.oj-mark.fal .oj-mark-tag { color:${C.red}; } .oj-mark.forte .oj-mark-tag { color:${C.green}; }

.oj-block { margin-bottom:14px; }
.oj-block-h { font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:1px; text-transform:uppercase; margin-bottom:7px; }
.oj-block-h.fail { color:${C.red}; } .oj-block-h.good { color:${C.green}; }
.oj-fallacy { border-left:2px solid ${C.redDim}; padding-left:12px; margin-bottom:11px; }
.oj-ftype { font-family:'Oswald',sans-serif; text-transform:uppercase; letter-spacing:1px; font-size:13px; color:${C.red}; }
.oj-fallacy blockquote { margin:5px 0; font-family:'JetBrains Mono',monospace; font-size:12px; color:${C.dim}; font-style:italic; }
.oj-fallacy p { margin:4px 0 0; font-size:13.5px; line-height:1.5; }
.oj-list { margin:0; padding-left:18px; } .oj-list li { font-size:13.5px; line-height:1.55; margin-bottom:4px; }

.oj-fc { display:flex; gap:12px; padding:11px 0; border-top:1px solid ${C.line}; } .oj-fc:first-of-type { border-top:none; }
.oj-fc-tag { flex-shrink:0; align-self:flex-start; font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; letter-spacing:1px; padding:4px 8px; }
.oj-fc-tag.verdadeiro { background:${C.green}; color:#0b160b; } .oj-fc-tag.falso { background:${C.red}; color:#fff; }
.oj-fc-tag.impreciso { background:${C.gold}; color:#1a1405; } .oj-fc-tag.inverificavel { background:${C.line}; color:${C.dim}; }
.oj-fc-claim { margin:0; font-size:14px; } .oj-fc-claim em { color:${C.dim}; } .oj-fc-exp { margin:4px 0 0; font-size:13px; color:${C.dim}; line-height:1.5; }

.oj-card.final { border-left:4px solid ${C.gold}; }
.oj-punch { font-family:'Oswald',sans-serif; font-size:21px; color:${C.red}; margin:0; text-transform:uppercase; letter-spacing:.5px; line-height:1.25; }

.oj-hist-head { display:flex; justify-content:space-between; align-items:center; }
.oj-clear { background:none; border:none; color:${C.redDim}; font-family:'JetBrains Mono',monospace; font-size:11px; cursor:pointer; text-transform:uppercase; } .oj-clear:hover { color:${C.red}; }
.oj-rank-head { display:grid; grid-template-columns:32px 1fr 70px 70px; gap:8px; font-family:'JetBrains Mono',monospace; font-size:10px; color:${C.dim}; text-transform:uppercase; letter-spacing:1px; padding-bottom:8px; border-bottom:1px solid ${C.line}; }
.oj-rank-row { display:grid; grid-template-columns:32px 1fr 70px 70px; gap:8px; align-items:center; padding:9px 0; border-bottom:1px solid ${C.line}; }
.oj-rank-pos { font-family:'Oswald',sans-serif; font-size:20px; color:${C.gold}; }
.oj-rank-name { font-family:'Oswald',sans-serif; text-transform:uppercase; letter-spacing:.5px; font-size:16px; }
.oj-rank-v { font-family:'JetBrains Mono',monospace; font-size:16px; text-align:center; }
.oj-hist-row { width:100%; text-align:left; background:transparent; border:none; border-bottom:1px solid ${C.line}; padding:13px 0; display:flex; justify-content:space-between; align-items:center; gap:14px; cursor:pointer; color:${C.ink}; }
.oj-hist-row:hover { background:${C.panel2}; }
.oj-hist-tema { font-size:15px; font-weight:600; } .oj-hist-meta { font-family:'JetBrains Mono',monospace; font-size:11px; color:${C.dim}; margin-top:3px; }
.oj-hist-wins { display:flex; flex-direction:column; gap:4px; align-items:flex-end; }
.oj-hist-wins .tag { font-family:'JetBrains Mono',monospace; font-size:10px; padding:2px 7px; white-space:nowrap; }
.tag.cyan { color:${C.cyan}; border:1px solid ${C.cyan}33; } .tag.gold { color:${C.gold}; border:1px solid ${C.gold}33; }
.oj-empty { color:${C.dim}; text-align:center; padding:40px 0; }
.oj-foot { text-align:center; color:#5b5648; font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:1px; margin-top:30px; }
`;
