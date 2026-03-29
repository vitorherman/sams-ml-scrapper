'use client';

import { useState } from 'react';
import { Loader2, Search, Download, MapPin, ExternalLink, TrendingUp } from 'lucide-react';

// Tipagem para suportar as colunas de comparação
interface ProductResult {
  produto: string;
  valor: string;      // Preço Sam's (formatado)
  link: string;       // Link Sam's
  precoML?: string;   // Preço ML (formatado)
  linkML?: string;    // Link da busca no ML
  diferenca?: string; // Diferença em R$
  variacao?: string;  // Variação em %
  isLucro?: boolean;  // Para destacar em verde/vermelho
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ProductResult[] | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setLocation(null);

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao buscar os dados');

      setResults(data.data);
      setLocation(data.location);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!results) return;
    const jsonString = JSON.stringify(results, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arbitragem-sams-ml.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-neutral-950 p-8 font-sans text-neutral-100">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            Sam&apos;s Club vs Mercado Livre
          </h1>
          <p className="text-neutral-400">
            Extração regionalizada com comparativo de arbitragem em tempo real.
          </p>
        </div>

        <div className="bg-neutral-900 p-6 rounded-xl shadow-sm border border-neutral-800">
          <form onSubmit={handleScrape} className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-neutral-500" />
              </div>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Insira a URL da categoria do Sam's Club..."
                className="block w-full pl-10 pr-3 py-3 bg-neutral-950 border border-neutral-800 rounded-lg focus:ring-2 focus:ring-blue-500 transition-colors text-white placeholder-neutral-600 font-medium"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-w-[220px]"
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Extraindo...
                </>
              ) : (
                'Iniciar Arbitragem'
              )}
            </button>
          </form>
          {error && (
            <div className="mt-4 p-4 bg-red-900/30 text-red-400 rounded-lg border border-red-800/50">
              {error}
            </div>
          )}
        </div>

        {results && (
          <div className="space-y-4">
            {location && (
              <div className="bg-blue-900/20 border border-blue-800/50 text-blue-300 px-4 py-3 rounded-lg flex items-center gap-2 w-fit">
                <MapPin className="h-5 w-5 text-blue-400" />
                <span className="font-medium">Localidade: {location}</span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-neutral-100">
                Oportunidades ({results.length} itens)
              </h2>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 text-sm font-medium text-neutral-300 hover:text-white bg-neutral-800 border border-neutral-700 px-4 py-2 rounded-lg transition-colors shadow-sm"
              >
                <Download className="h-4 w-4" />
                Exportar JSON
              </button>
            </div>

            <div className="bg-neutral-900 rounded-xl shadow-sm border border-neutral-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-950 border-b border-neutral-800 text-neutral-400">
                    <tr>
                      <th className="px-6 py-4 font-semibold uppercase text-[11px]">Produto</th>
                      <th className="px-6 py-4 font-semibold uppercase text-[11px] text-center">Preço Sam&apos;s</th>
                      <th className="px-6 py-4 font-semibold uppercase text-[11px] text-center">Preço ML</th>
                      <th className="px-6 py-4 font-semibold uppercase text-[11px] text-center">Diferença R$</th>
                      <th className="px-6 py-4 font-semibold uppercase text-[11px] text-center">Variação %</th>
                      <th className="px-6 py-4 font-semibold uppercase text-[11px] text-center">Links</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {results.map((item, index) => (
                      <tr key={index} className="hover:bg-neutral-800/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-neutral-200">
                          {item.produto}
                        </td>
                        <td className="px-6 py-4 text-center text-neutral-300 whitespace-nowrap">
                          {item.valor}
                        </td>
                        <td className="px-6 py-4 text-center text-yellow-500 font-bold whitespace-nowrap">
                          {item.precoML || '---'}
                        </td>
                        <td className={`px-6 py-4 text-center font-bold whitespace-nowrap ${item.isLucro ? 'text-green-500' : 'text-red-400'}`}>
                          {item.diferenca || '---'}
                        </td>
                        <td className={`px-6 py-4 text-center font-bold whitespace-nowrap ${item.isLucro ? 'text-green-500' : 'text-red-400'}`}>
                          {item.variacao || '---'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-4">
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium transition-colors"
                              title="Ver no Sam's"
                            >
                              Sam&apos;s <ExternalLink size={12}/>
                            </a>
                            {item.linkML && (
                                <a
                                  href={item.linkML}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-yellow-500 hover:text-yellow-400 flex items-center gap-1 font-medium transition-colors"
                                  title="Ver no Mercado Livre"
                                >
                                  ML <ExternalLink size={12}/>
                                </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[10px] text-neutral-500 italic px-2">
              * Diferença e variação calculadas com base no preço bruto entre as plataformas.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}