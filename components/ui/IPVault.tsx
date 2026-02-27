'use client';

interface VaultItem {
  url: string;
  prompt?: string;
  rationale?: string;
}

export function IPVault({ items }: { items: VaultItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 border border-dashed border-neutral-700 rounded-xl text-neutral-500 text-sm p-6 text-center">
        The vault is empty.<br/>Tell the Agent to design something.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 pb-20">
      {items.map((item, index) => (
        <div key={index} className="group relative rounded-xl overflow-hidden border border-neutral-800 bg-neutral-900 shadow-2xl transition-all hover:border-cyan-400">
          <div className="relative w-full aspect-video">
            {item.url ? (
              <img
                src={item.url}
                alt={item.prompt || "Generated Vault Asset"}
                className="object-cover w-full h-full"
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full bg-neutral-800 text-neutral-500 text-xs">
                Image loading...
              </div>
            )}
          </div>
          <div className="p-4 flex justify-between items-center">
            <p className="text-xs font-mono text-neutral-400 tracking-widest uppercase">
              Vault Asset #{index + 1}
            </p>
            {item.url && (
              <a
                href={item.url}
                download={`lorestream_asset_${index}.png`}
                target="_blank" rel="noreferrer"
                className="text-xs bg-white text-black px-3 py-1 rounded hover:bg-gray-200 font-bold"
              >
                Export
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}