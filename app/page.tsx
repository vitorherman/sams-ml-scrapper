'use client';

import { useState } from 'react';
import { Loader2, Search, Download, MapPin } from 'lucide-react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ produto: string; valor: string; link: string }[] | null>(null);
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Falha ao buscar os dados');
      }

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
    a.download = 'sams-club-products.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-neutral-950 p-8 font-sans text-neutral-100">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Sam&apos;s Club Scraper</h1>
          <p className="text-neutral-400">
            Insira a URL de uma categoria do Sam&apos;s Club para extrair os produtos e preços.
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
                placeholder="https://www.samsclub.com.br/..."
                className="block w-full pl-10 pr-3 py-3 bg-neutral-950 border border-neutral-800 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-white placeholder-neutral-600"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Extraindo...
                </>
              ) : (
                'Extrair Dados'
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
              <div className="bg-blue-900/20 border border-blue-800/50 text-blue-300 px-4 py-3 rounded-lg flex items-center gap-2">
                <MapPin className="h-5 w-5 text-blue-400" />
                <span className="font-medium">Localidade detectada:</span>
                <span>{location}</span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-neutral-100">
                Resultados ({results.length} produtos encontrados)
              </h2>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 text-sm font-medium text-neutral-300 hover:text-white bg-neutral-800 border border-neutral-700 px-4 py-2 rounded-lg transition-colors shadow-sm"
              >
                <Download className="h-4 w-4" />
                Baixar JSON
              </button>
            </div>

            <div className="bg-neutral-900 rounded-xl shadow-sm border border-neutral-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-950 border-b border-neutral-800 text-neutral-400">
                    <tr>
                      <th className="px-6 py-4 font-medium">Produto</th>
                      <th className="px-6 py-4 font-medium w-32">Preço</th>
                      <th className="px-6 py-4 font-medium w-24">Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {results.map((item, index) => (
                      <tr key={index} className="hover:bg-neutral-800/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-neutral-200">
                          {item.produto}
                        </td>
                        <td className="px-6 py-4 text-neutral-400 whitespace-nowrap">
                          {item.valor}
                        </td>
                        <td className="px-6 py-4">
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            Abrir
                          </a>
                        </td>
                      </tr>
                    ))}
                    {results.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-neutral-500">
                          Nenhum produto encontrado. Verifique a URL ou tente novamente.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
