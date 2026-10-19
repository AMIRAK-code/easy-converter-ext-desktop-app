// Conversion planner. Each converter registers as an edge between formats;
// any-to-any conversion is the cheapest chain of edges (max 3 hops).

import { targetAllowed, sortTargets } from './formats.js';

const HOP_PENALTY = 0.35;

export class ConversionGraph {
  constructor() {
    this.edges = [];
  }

  /**
   * @param {object} edge
   * @param {string} edge.id
   * @param {string[]} edge.from   source formats
   * @param {string[]} edge.to     target formats
   * @param {number|((from:string,to:string)=>number|null)} [edge.cost=1] lower is better; null = unsupported pair
   * @param {boolean} [edge.terminal=false] output can't feed another edge (e.g. one image per page)
   * @param {Function} edge.run    environment-specific implementation
   */
  add(edge) {
    this.edges.push({ cost: 1, terminal: false, ...edge });
    return this;
  }

  edgeCost(edge, from, to) {
    if (from === to || !edge.from.includes(from) || !edge.to.includes(to)) return null;
    const c = typeof edge.cost === 'function' ? edge.cost(from, to) : edge.cost;
    return c == null ? null : c;
  }

  /** Cheapest route to every reachable format: Map<fmt, {cost, steps}>. */
  routesFrom(src, { maxHops = 3, exclude } = {}) {
    const best = new Map();
    let layer = new Map([[src, { cost: 0, steps: [], terminal: false }]]);
    for (let hop = 1; hop <= maxHops; hop++) {
      const next = new Map();
      for (const [node, route] of layer) {
        if (route.terminal) continue;
        for (const edge of this.edges) {
          if (!edge.from.includes(node) || exclude?.has(edge.id)) continue;
          for (const to of edge.to) {
            if (to === src || route.steps.some((s) => s.from === to)) continue;
            const c = this.edgeCost(edge, node, to);
            if (c == null) continue;
            const cost = route.cost + c + (hop > 1 ? HOP_PENALTY : 0);
            const prev = next.get(to);
            if (!prev || cost < prev.cost) {
              next.set(to, {
                cost,
                steps: [...route.steps, { edge, from: node, to }],
                terminal: edge.terminal,
              });
            }
          }
        }
      }
      for (const [to, r] of next) {
        const prev = best.get(to);
        if (!prev || r.cost < prev.cost) best.set(to, r);
      }
      layer = next;
      if (!layer.size) break;
    }
    return best;
  }

  plan(src, dst, opts) {
    return this.routesFrom(src, opts).get(dst) ?? null;
  }

  /** Allowed, reachable targets for a source, most useful first. */
  targets(src, opts) {
    const routes = this.routesFrom(src, opts);
    const allowed = [...routes.keys()].filter((t) => targetAllowed(src, t));
    return sortTargets(src, allowed).map((to) => ({ to, ...routes.get(to) }));
  }

  /** Targets reachable from every one of several source formats. */
  commonTargets(srcs, opts) {
    const unique = [...new Set(srcs)];
    if (unique.length <= 1) return unique.length ? this.targets(unique[0], opts) : [];
    // A file already in the target format just gets skipped, so it doesn't block that target.
    const reach = unique.map((s) => new Set([s, ...this.targets(s, opts).map((t) => t.to)]));
    const all = [...new Set(reach.flatMap((r) => [...r]))];
    const common = all.filter((t) => reach.every((r) => r.has(t)) && !unique.every((s) => s === t));
    return sortTargets(unique[0], common).map((to) => ({ to }));
  }
}

export function describeRoute(route) {
  if (!route) return 'unsupported';
  return [route.steps[0]?.from, ...route.steps.map((s) => `${s.to} (${s.edge.id})`)].join(' → ');
}
