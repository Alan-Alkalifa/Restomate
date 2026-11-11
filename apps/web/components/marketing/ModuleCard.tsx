export type ModuleCopy = { title: string; summary: string; points: readonly string[] };

export function ModuleCard({ module, showPoints = false }: { module: ModuleCopy; showPoints?: boolean }) {
  return (
    <li className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
      <h3 className="text-lg font-semibold">{module.title}</h3>
      <p className="mt-1 text-neutral-700 dark:text-neutral-300">{module.summary}</p>
      {showPoints ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-neutral-700 dark:text-neutral-300">
          {module.points.map((p) => <li key={p}>{p}</li>)}
        </ul>
      ) : null}
    </li>
  );
}
