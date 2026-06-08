import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = (process.env.JUDGE_MODEL || "claude-opus-4-8").trim();

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

  const { images } = body || {};
  if (!Array.isArray(images) || images.length === 0) {
    return Response.json({ error: "Nenhuma imagem enviada." }, { status: 400 });
  }

  const client = new Anthropic();
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          ...images,
          {
            type: "text",
            text: "Estas são prints de uma conversa (provavelmente WhatsApp). Transcreva TODAS as mensagens em ordem, no formato 'Nome: mensagem', uma linha por mensagem. Sem timestamps, sem comentários seus, sem markdown — só a transcrição limpa.",
          },
        ],
      }],
    });

    const text = (resp.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!text) return Response.json({ error: "Não consegui ler o print." }, { status: 502 });
    return Response.json({ text });
  } catch (e) {
    const msg = e?.error?.error?.message || e?.message || "Erro ao transcrever.";
    const status = typeof e?.status === "number" ? e.status : 500;
    return Response.json({ error: msg }, { status });
  }
}
