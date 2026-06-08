import Anthropic from "@anthropic-ai/sdk";

// O Juiz pode demorar (raciocínio + busca na web). Sem timeout curto da plataforma.
export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = (process.env.JUDGE_MODEL || "claude-opus-4-8").trim();

// Extrai o primeiro objeto JSON do texto (tolera cercas de código residuais).
function extractJSON(t) {
  if (!t) return null;
  const s = t.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a === -1 || b === -1) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY não configurada no servidor (.env.local)." },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const { prompt, factCheck } = body || {};
  if (typeof prompt !== "string" || prompt.trim().length < 20) {
    return Response.json({ error: "Prompt vazio ou curto demais." }, { status: 400 });
  }

  const client = new Anthropic();

  const params = {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    messages: [{ role: "user", content: prompt }],
  };
  if (factCheck) {
    params.tools = [{ type: "web_search_20260209", name: "web_search" }];
  }

  try {
    // Servidor pode pausar a busca após N iterações (pause_turn) — reenviar para continuar.
    let response = await client.messages.create(params);
    let guard = 0;
    while (response.stop_reason === "pause_turn" && guard < 5) {
      params.messages = [
        ...params.messages,
        { role: "assistant", content: response.content },
      ];
      response = await client.messages.create(params);
      guard++;
    }

    if (response.stop_reason === "refusal") {
      return Response.json(
        { error: "A IA recusou avaliar este conteúdo." },
        { status: 422 }
      );
    }

    const text = (response.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const result = extractJSON(text);
    if (!result) {
      return Response.json(
        { error: "Não consegui interpretar o veredicto. Tenta de novo." },
        { status: 502 }
      );
    }

    return Response.json({ result });
  } catch (e) {
    const msg =
      e?.error?.error?.message || e?.message || "Deu ruim na chamada à IA.";
    const status = typeof e?.status === "number" ? e.status : 500;
    return Response.json({ error: msg }, { status });
  }
}
