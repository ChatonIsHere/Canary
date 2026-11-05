import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

// One of the page's sections: a card with an h2, reachable from the section links.
export function Section({ id, title, sub, children }: { id: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4">
      <Card className="gap-4 py-5 text-base sm:py-6 [--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">
            <h2 id={`${id}-title`}>{title}</h2>
          </CardTitle>
          {sub && <CardDescription className="max-w-[70ch]">{sub}</CardDescription>}
        </CardHeader>
        {children && <CardContent className="grid min-w-0 grid-cols-1 gap-4">{children}</CardContent>}
      </Card>
    </section>
  )
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mt-2 text-lg font-semibold">{children}</h3>
}
