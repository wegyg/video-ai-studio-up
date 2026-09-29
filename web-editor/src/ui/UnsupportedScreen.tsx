import { ko } from '../i18n/ko';

/** WebCodecs를 쓸 수 없는 환경 안내 (R1.3) */
export function UnsupportedScreen({ insecure }: { insecure: boolean }) {
  return (
    <main className="flex h-full items-center justify-center p-6" data-testid="unsupported">
      <div className="max-w-xl rounded-xl bg-neutral-900 p-6 leading-relaxed shadow-xl">
        <h1 className="mb-3 text-xl font-bold">{ko.unsupported.title}</h1>
        <p className="mb-4 text-neutral-300">{insecure ? ko.unsupported.insecure : ko.unsupported.noWebcodecs}</p>
        <h2 className="mb-2 font-bold text-cyan-300">{ko.unsupported.howtoTitle}</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-300">
          {ko.unsupported.howto.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
