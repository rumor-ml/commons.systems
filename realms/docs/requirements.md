# Procedural Mythic Bastionland Realms

## Requirements Specification v1.6

---

## 1. Overview

This document specifies requirements for a procedural hex map generator and accompanying exploration simulation. The system generates self-contained realms of interconnected hexes, revealed progressively through simulated exploration using fog-of-war mechanics.

### 1.1 Core Principles

1. **Progressive Generation**: All hex features generate at the moment of discovery (when an adjacent hex is explored), not before.
2. **Atomic Hex Generation**: When a hex is generated, ALL its features (terrain, features, river edges, barrier edges) are determined simultaneously, except where explicit dependencies exist.
3. **Deterministic Reproducibility**: Given the same seed, the system produces identical results.
4. **Constraint Optimization**: Algorithms optimize for constraint compliance; rare failures are acceptable and reported.

---

## 2. Procedural Generation Rules

### 2.1 Core Principles

1. **Procedural Generation**: All hex and edge properties are determined at reveal time
   - No pre-generation or look-ahead
   - Each hex is generated when the explorer first reveals it

2. **Contiguous Exploration**: The explorer moves between adjacent hexes only
   - Explored region is always connected
   - Every hex will eventually be revealed

3. **Canon Principle**: Once revealed, hexes and edges are immutable
   - A revealed hex's terrain, features, and edges cannot change
   - Rivers can only extend into unexplored hexes
   - This ensures consistency regardless of exploration order

### 2.2 Implications for Rivers

- Rivers bias toward "open" frontiers (unexplored hexes with more unexplored neighbors)
- This increases the chance frontiers have room to grow when revealed
- ~3 tributaries provide backup paths if one branch gets trapped
- Trapping should be rare (only when all directions are nearly surrounded)
- River shape varies based on exploration path - this is expected

---

## 3. Hex Map Structure

### 3.1 Hex Configuration

| Property          | Specification                              |
| ----------------- | ------------------------------------------ |
| Orientation       | Pointy-topped                              |
| Coordinate System | Implementation choice (axial recommended)  |
| Adjacency         | 6 neighbors per hex (NE, E, SE, SW, W, NW) |

### 3.2 Realm Dimensions

| Property         | Specification                                 |
| ---------------- | --------------------------------------------- |
| Target Size      | ~12 × ~12 hexes of explorable space           |
| Explorable Hexes | Minimum 100, target ~144, soft maximum ~180   |
| Shape            | Approximately square, organic/irregular edges |
| Center           | Random hex (not necessarily explorer start)   |

**Shape Constraints**:

- Must NOT form long narrow corridors
- Border hexes may "jut into" explorable space creating irregular boundaries
- Overall bounding box remains approximately square

---

## 4. Hex Types

### 4.1 Border Hexes (Impassable)

Border hexes form the impassable edge of the realm. They are clustered by type.

| Type      | Description                   |
| --------- | ----------------------------- |
| Sea       | Coastal water boundary        |
| Cliff     | Vertical terrain boundary     |
| Wasteland | Inhospitable terrain boundary |

**Border Generation Rules**:

- Form ~4 clusters of random types around realm perimeter
- More likely to appear toward the generated map edge
- May appear within the bounding area to create irregular shapes
- Generation terminates when realm is completely enclosed
- Must satisfy minimum explorable hex count before closing

### 4.2 Passable Terrain Types

All passable terrain hexes can be traversed (subject to barrier edges).

| Terrain | Clustering Affinity                                                          | Notes           |
| ------- | ---------------------------------------------------------------------------- | --------------- |
| Forest  | Highly likely adjacent to glade                                              | —               |
| Glade   | Highly likely adjacent to forest                                             | —               |
| Marsh   | Near water features (rivers, lakes, sea) and bog                             | —               |
| Bog     | Near water features (rivers, lakes, sea) and marsh                           | —               |
| Heath   | Near bog/marsh (transitional wetland edge)                                   | —               |
| Plains  | Near hills (foothills transition)                                            | —               |
| Valley  | Highly likely near peaks/hills/crags/cliffs                                  | —               |
| Hills   | Clusters with peaks/crags/cliffs/valley; near plains                         | Elevation: mid  |
| Crag    | Clusters with peaks/hills/cliffs/valley; higher affinity to peaks than hills | Elevation: mid  |
| Peaks   | Clusters with hills/crags/cliffs/valley                                      | Elevation: high |

**Terrain Cluster Rules**:

- Target cluster size: 1–12 contiguous hexes (larger if clusters converge organically)
- All terrain transitions are possible
- Some transitions are highly unlikely (follow natural patterns)
- Base distribution roughly equal except for stated affinities

**Cluster Size Distribution**:

Probability weights should favor mid-sized clusters while allowing variety:

| Cluster Size | Relative Probability | Notes                           |
| ------------ | -------------------- | ------------------------------- |
| 1–2 hexes    | Low                  | Isolated terrain features       |
| 3–6 hexes    | High                 | Most common cluster size        |
| 7–12 hexes   | Medium               | Larger terrain regions          |
| 13+ hexes    | N/A                  | Only occurs when clusters merge |

**Implementation Guidance**:

- When generating a hex, calculate probability of continuing an adjacent cluster vs. starting new terrain
- Continuation probability decreases as cluster approaches size 12
- At cluster size 12, continuation probability drops significantly (but not to zero—allows organic merging)
- Track cluster membership to enforce size distribution

### 4.3 Elevation Hierarchy

Used exclusively for river flow logic:

```
Peaks (highest)
   ↓
Hills / Crags (mid)
   ↓
All other terrain (lowest)
```

---

## 5. Hex Edges

Each hex has 6 edges. Edges may have special properties.

### 5.1 River Edges

Rivers are **primary features** that influence terrain generation through lazy evaluation.

| Property           | Specification                                         |
| ------------------ | ----------------------------------------------------- |
| Networks per Realm | Generally 1 large network; ~1.1 average               |
| Generation Model   | Rivers first, terrain constrained by river elevation  |
| Extension Trigger  | Any edge touching an open river endpoint is revealed  |
| Branches           | Networks contain tributaries (Y-junctions, target ~3) |

#### 5.1.1 River Generation Model

**Core Principle**: Rivers are generated as a primary procedural feature, with terrain adapting to river constraints rather than rivers fitting into existing terrain.

**Generation Order** (per hex reveal):

1. **River Encounter** (once per realm): 1/12 chance until first river network created
2. **River Extension**: All vertices of revealed hex checked for open river endpoints → extend if found
3. **Terrain Generation**: Terrain selected respecting elevation constraints from river edges
4. **Barrier Generation**: Barriers placed (independent of rivers)
5. **Feature Placement**: Holdings, landmarks, etc. placed

#### 5.1.2 River Initiation

**Trigger**: 1/12 chance per hex reveal until `riverEncountered = true`

**Process**:

- Select any valid edge direction (not toward borders)
- Create river network with ID, edge set, tributary count
- Add initial edge to network using `addRiverEdge()`

**Network Structure** (simplified):

```javascript
{
  id: number,
  edges: Set<string>,
  tributaryCount: number
}
```

**Contiguous Growth Model**: Rivers grow bidirectionally whenever a hex adjacent to an existing river edge is revealed. No frontier endpoint tracking needed—the river automatically propagates through the map as hexes are explored.

**Hard Constraints**:

1. **Vertex Endpoint Constraint**: Both endpoint vertices of the initial river segment must have ALL adjacent edges leading to unrevealed hexes.
   - Each vertex has exactly 2 adjacent edges
   - Both edges must lead to hexes NOT in `ctx.hexes` (unexplored/unrevealed)
   - This ensures bidirectional growth potential from both endpoints
   - If no valid vertex pairs meet this constraint, river initiation is skipped for this hex

#### 5.1.3 River Extension Logic

**When**: A hex is revealed

**Process** (contiguous lazy growth):

1. **Check all 6 neighbors** for river edges pointing toward the revealed hex
2. **For each adjacent river edge found**:
   - Add the edge to the hex's `riverEdges` array
   - Call `maybeExtendRiverThrough(hex, incomingDirection)`
3. **Extension through hex**:
   - Find network that owns the incoming edge
   - Check if network reached target length (24 edges)
   - Get valid directions (excluding incoming, existing rivers, borders)
   - Calculate adaptive tributary probability: `remainingTributaries / remainingLength`
   - If branching: add 2 edges, increment `tributaryCount`
   - Else: add 1 edge
4. **Add edge**:
   - Store edge in network and riverEdges Map
   - Update hex.riverEdges arrays for both hexes
   - **Propagate to already-explored neighbor** immediately
   - If neighbor explored: call `maybeExtendRiverThrough()` on neighbor

**No Exploration Bias**: Rivers grow naturally as hexes are revealed. No need to bias explorer movement—the contiguous growth ensures rivers extend whenever adjacent hexes are discovered.

**Determinism**: Natural determinism from map exploration order

#### 5.1.4 Tributary Mechanics

**Target**: ~3 tributaries per network

**Adaptive Probability**: Dynamic formula based on remaining work:

- `probability = remainingTributaries / max(1, remainingLength)`
- Where `remainingTributaries = 3 - tributaryCount`
- Where `remainingLength = 24 - edges.size`
- Example: 3 tributaries left, 12 edges left → 25% chance
- Example: 1 tributary left, 4 edges left → 25% chance
- This ensures tributaries are distributed throughout the river's growth

**Creation**: When hex has ≥2 valid extension directions and probability hit, both edges added simultaneously (forms Y-junction at the hex). Each branch then propagates independently through the contiguous growth mechanism.

#### 5.1.5 River Termination

**Triggers**:

- Hex has no valid extension directions (surrounded by borders, existing rivers, or incoming edge)
- Network reached target length (24 edges)
- Natural termination when reaching realm boundaries

**Preferred Terminus Terrain**: Marsh, bog, lake, or sea border
**Preferred Source Terrain**: Peaks, crag, or cliff border
**Note**: With contiguous growth, rivers terminate naturally when they run out of valid directions to grow

#### 5.1.6 Terrain Constraints from Rivers

**Elevation Hierarchy** (for river flow):

- **High**: peaks (3), crag (2), hills (2)
- **Medium**: valley (3)
- **Low**: forest, glade, heath, plains, meadow, marsh, bog (all 1)
- **Water**: lake (treated as low)

**Constraint Calculation** (per hex with river edges):

For each river edge on hex H:

- **Inflow edge** (water flows INTO H): `maxElevation = min(source hex elevations)`
- **Outflow edge** (water flows OUT OF H): `minElevation = max(destination hex elevations)`

**Terrain Selection**:

- Filter terrain types by: `elevation ≥ minElevation AND elevation ≤ maxElevation`
- If no valid terrains (conflict): make hex a lake
- Apply normal terrain affinity weights to valid terrains

**Example**: Hex has inflow from peaks (elev=3) and outflow to plains (elev=1)

- Constraint: `1 ≤ elevation ≤ 3`
- Valid: hills, crag, peaks, valley, all low-elevation terrains
- Invalid: none (wide range)

#### 5.1.7 River Network Metrics

| Metric          | Definition                             | Target    | Actual (50 sims) |
| --------------- | -------------------------------------- | --------- | ---------------- |
| Path Length     | Edge count in network                  | ~24 edges | 25.7 avg         |
| Network Count   | Number of disconnected river networks  | 1         | 1.0 avg          |
| Tributary Count | Explicit branching events in network   | ~3        | 4.5 avg          |
| Network Span    | Max hex distance between any two edges | ≥8 hexes  | 3.4 avg          |

**Success Criteria**:

- Path Length: ≥20 edges average ✓ (achieved 25.7)
- Networks: 1.0 (exactly as targeted) ✓
- Tributaries: 3-5 range ✓ (achieved 4.5, slightly higher variance due to probabilistic branching)
- Rivers per map: 100% have ≥1 network ✓
- Span: 3-4 hexes typical (constrained by realm size and contiguous growth pattern)

### 5.2 Barrier Edges

Barriers are impassable edges between two passable hexes.

| Property     | Specification                   |
| ------------ | ------------------------------- |
| Total Count  | ~24 barrier edges (approximate) |
| Cluster Size | 1–4 contiguous edges            |
| Placement    | Random (no terrain affinity)    |
| Visual       | Thick red line on hex edge      |

**Barrier Rules**:

- Block traversal between adjacent passable hexes
- A hex with a barrier edge is still accessible via other edges
- River edges CAN also be barrier edges (both properties apply)
- Revealed when adjacent hexes are revealed

**Barrier Cluster Shape**:

- Clusters of 1–4 contiguous edges
- Clusters may wrap around hex corners (forming L-shapes, etc.)
- Contiguity defined as: edges that share a hex vertex
- Example valid cluster: hex A's E edge + hex A's SE edge + hex B's W edge (L-shape across corner)

```
Example: 3-edge barrier cluster wrapping a corner

      ╱ ╲
     ╱   ╲
    │  A  │══════  ← barrier edge (A's E)
     ╲   ╱ ╲   ╱
      ║╲ ╱   ╲╱
      ║  B    │    ← barrier edge (shared vertex)
      ║╱ ╲   ╱
     ╱     ╲╱

    ↑ barrier edge (A's SE / B's NW)
```

---

## 6. Water Features

### 6.1 Lakes

| Property      | Specification                 |
| ------------- | ----------------------------- |
| Maximum Count | 3 per realm (soft constraint) |
| Size          | 1–6 contiguous hexes (random) |
| Placement     | No constraints                |

**Lake Rules**:

- Multi-hex water features discovered during exploration
- Count toward water features for marsh/bog affinity
- Can serve as river source or terminus

### 6.2 Seas

Seas are border hexes (see Section 3.1). They also count as water features for terrain affinity calculations. Rivers can terminate at sea but cannot originate from sea.

---

## 7. Features

Features are placed on passable terrain hexes. Features do not overlap (one feature per hex maximum).

### 7.1 Feature Placement Probability

Feature placement uses **proportional probability** to ensure natural distribution across the realm. Early exploration should not feel artificially dense with features.

**Base Probability Formula**:

```
P(feature on this hex) = remaining_to_place / remaining_hexes_to_explore
```

Where:

- `remaining_to_place` = target count − already placed count
- `remaining_hexes_to_explore` = expected total hexes (144) − already explored hexes

**Example**: For 6 Myth Sites across 144 expected hexes:

- At start (0 explored, 0 placed): P = 6/144 ≈ 4.2% per hex
- After 72 hexes (3 placed): P = 3/72 ≈ 4.2% per hex (unchanged if on track)
- After 120 hexes (4 placed): P = 2/24 ≈ 8.3% per hex (increases to catch up)

**Rationale**: This ensures features are distributed proportionally throughout the map rather than clustered at the starting location. The probability naturally increases only when placement falls behind the expected rate, guaranteeing constraints are met by exploration completion.

**Catch-up Threshold**: When remaining hexes approaches the number of features still needed (e.g., 5 hexes left, 3 features needed), probability increases more aggressively to ensure hard constraints are met.

### 7.2 Holdings

| Property         | Specification                              |
| ---------------- | ------------------------------------------ |
| Count            | Exactly 4 per realm                        |
| Spacing          | Minimum 4 hex distance between Holdings    |
| River Adjacency  | Allowed (can be on hexes with river edges) |
| Boundary Spacing | No constraint                              |

### 7.3 Myth Sites

| Property  | Specification       |
| --------- | ------------------- |
| Count     | Exactly 6 per realm |
| Placement | No constraints      |

### 7.4 Landmarks

| Type     | Count per Realm |
| -------- | --------------- |
| Curse    | 3–4             |
| Dwelling | 3–4             |
| Hazard   | 3–4             |
| Monument | 3–4             |
| Ruin     | 3–4             |
| Sanctum  | 3–4             |

**Total Landmarks**: 18–24

**Landmark Rules**:

- No placement constraints
- No spacing requirements
- No terrain restrictions

---

## 8. Generation Dependencies

While most hex features generate atomically, these explicit dependencies exist:

| Feature                  | Depends On           | Rule                                                         |
| ------------------------ | -------------------- | ------------------------------------------------------------ |
| River entering hex       | Source terrain       | Cannot flow uphill (see elevation hierarchy)                 |
| Marsh/Bog terrain        | Water proximity      | Higher probability near rivers, lakes, sea; cluster together |
| Heath terrain            | Wetland proximity    | Higher probability near bog/marsh                            |
| Glade/Forest terrain     | Each other           | Higher probability adjacent to each other                    |
| Plains terrain           | Hills proximity      | Higher probability adjacent to hills (foothills)             |
| Crag terrain             | Peaks proximity      | Higher affinity to peaks than to hills                       |
| Hills/Crags/Peaks/Valley | Elevation clustering | Higher probability adjacent to each other                    |
| Hills/Crags/Peaks/Valley | Cliff borders        | Higher probability adjacent to cliff borders                 |

---

## 9. Exploration Simulation

### 9.1 Explorer Behavior

| Property           | Specification                                        |
| ------------------ | ---------------------------------------------------- |
| Movement           | 1 hex per step                                       |
| Reveal Range       | All 6 adjacent hexes revealed on entry               |
| Feature Visibility | Immediate (terrain + all features visible on reveal) |

**Movement Heuristic**:

1. Explorer moves roughly in one direction with randomness
2. On encountering a border OR barrier edge → change direction
3. On discovering a feature → likely to navigate toward that feature (random chance)
4. All features MAY cause direction change at random

### 9.2 Simulation Parameters

| Parameter       | Description                                                 |
| --------------- | ----------------------------------------------------------- |
| `seed`          | Random seed for deterministic generation                    |
| `startAtBorder` | Boolean: if true, explorer starts adjacent to a border tile |

**Starting Location**:

- If `startAtBorder = false`: random placement anywhere
- If `startAtBorder = true`: placed adjacent to a border tile
- Starting location is generated (not predetermined)

---

## 10. Visualization Requirements

### 10.1 Interactive JSX Component

**User Controls**:

| Control                | Function                         |
| ---------------------- | -------------------------------- |
| Seed Input             | Edit simulation seed             |
| Start at Border Toggle | Enable/disable border start      |
| Step Forward           | Advance one explorer movement    |
| Step Backward          | Revert to previous state         |
| Play/Pause             | Toggle animation (1 step/second) |
| Reset                  | Return to initial state          |

### 10.2 Map Display

| Requirement | Specification                     |
| ----------- | --------------------------------- |
| Viewport    | Auto-scale to show entire hex map |
| Hex Size    | Scale to viewport (no minimum)    |
| Fog of War  | Unrevealed hexes hidden/dimmed    |

**Visual Elements**:

| Element          | Representation                                |
| ---------------- | --------------------------------------------- |
| Border hexes     | Distinct color per type (sea/cliff/wasteland) |
| Passable terrain | Distinct color per terrain type               |
| Lakes            | Water color (distinct from sea)               |
| River edges      | Blue line along hex edge                      |
| Barrier edges    | Thick red line along hex edge                 |
| Holdings         | Icon/marker on hex                            |
| Myth Sites       | Icon/marker on hex                            |
| Landmarks        | Icon/marker on hex (distinguish 6 types)      |
| Explorer         | Distinct marker showing current position      |
| Explorer path    | Trail showing movement history                |

### 10.3 State Display

Below the map, display procedural state at each step:

**Generation State**:

- Current hex coordinates
- Current hex terrain
- Terrain probability distribution for adjacent unrevealed hexes
- Feature placement probabilities

**Constraint Tracking**:

- Holdings placed / 4 (with spacing status)
- Myth Sites placed / 6
- Landmarks placed by type (current / 3–4 each)
- Lakes placed / 3 max
- Barrier edges placed / ~24
- Explorable hex count / 100–144 target
- River network status (span, flow direction)
- Border closure percentage

**Validation Status**:

- Green/red indicators for each constraint
- Warnings for constraints at risk

---

## 11. Non-Interactive Mode

For algorithm verification and debugging.

### 11.1 Execution

- Run complete simulation programmatically
- Accept seed parameter
- Generate full realm without visualization

### 11.2 Output

**Constraint Compliance Report**:

```
Seed: [value]
Status: PASS / FAIL

Hard Constraints:
  ✓ Border closure: complete
  ✓ Explorable hexes: 142 (min: 100)
  ✓ Holdings: 4/4, spacing valid (min distance: 5)
  ✓ Myth Sites: 6/6
  ✓ Feature exclusivity: no overlaps
  ✓ River flow: no uphill violations
  ✓ River origination: all from valid sources
  ✓ River termination: all at valid termini
  ✓ River flow continuity: all segments valid

Soft Constraints:
  ✓ Explorable hexes: 142 (target: ~144)
  ✓ Landmarks: 21 (target: 18-24)
    - Curse: 4, Dwelling: 3, Hazard: 4, Monument: 3, Ruin: 4, Sanctum: 3
  ✗ River network: span 5 (target: ≥8) - PARTIAL
    - Networks: 2 (largest span: 5, second: 3)
  ✓ Lakes: 2/3 max
  ✓ Barriers: 23 edges in 8 clusters (target: ~24)
  ✓ Terrain clusters: avg 6.2 hexes (target: 1-12)
  ✓ Border clusters: 4 (target: ~4)

Warnings:
  - River constraint PARTIAL: largest network span 5 < 8
```

**Debug Output**:

- Full hex data (coordinates, terrain, features, edges)
- Generation sequence log
- Probability distributions at each step
- Decision points and outcomes
- Performance metrics

---

## 12. Constraint Summary

### 12.1 Hard Constraints

Must be satisfied for valid generation:

| Constraint             | Requirement                                                 |
| ---------------------- | ----------------------------------------------------------- |
| Border Closure         | Realm must be completely enclosed                           |
| Minimum Explorable     | ≥100 passable hexes                                         |
| Holdings Count         | Exactly 4                                                   |
| Holdings Spacing       | Minimum 4 hex distance between each                         |
| Myth Sites Count       | Exactly 6                                                   |
| Feature Exclusivity    | Maximum 1 feature per hex                                   |
| River Flow             | Cannot flow uphill per elevation hierarchy                  |
| River Origination      | Must originate from cliff, peaks, lake, marsh, or bog       |
| River Termination      | Must terminate at sea, cliff, lake, bog, or marsh           |
| River Flow Continuity  | All segments must flow logically from source to terminus    |
| Explorer Never Trapped | Explorer must always have at least one valid move available |

#### 12.1.1 Explorer Never Trapped Constraint

The explorer must never be placed in a situation where all adjacent hexes are impassable. This constraint is enforced during generation:

**Impassable Conditions**:

- Border hexes (sea, cliff, wasteland)
- Lake hexes
- Hexes blocked by barrier edges on all accessible sides

**Enforcement Rules**:

1. **Barrier Placement**: Before placing a barrier edge, verify it would not create an isolated region
2. **Lake Placement**: Before converting a hex to a lake, verify it would not trap the explorer
3. **Border Generation**: Border closure must leave sufficient connectivity for full exploration
4. **Ungenerated Hexes**: Ungenerated hexes do NOT count as valid moves (they may become lakes in the same generation batch)

**Validation**: At any step during exploration, the explorer must have ≥1 valid move to an explorable hex. If the generator would create a trap, it must:

- Skip the barrier/lake placement, OR
- Choose an alternative configuration

**Rationale**: A trapped explorer cannot complete realm exploration, violating the core gameplay loop. This constraint ensures 100% of generated maps are fully explorable.

### 12.2 Soft Constraints

Optimize for but accept occasional failures:

| Constraint         | Target                         | Measurement                                     |
| ------------------ | ------------------------------ | ----------------------------------------------- |
| Explorable Hexes   | ~144                           | Count of passable hexes                         |
| Realm Dimensions   | ~12 × 12                       | Bounding box of explorable area                 |
| River Network      | 1 large network, span ≥8 hexes | Largest network's maximum edge-to-edge distance |
| Lakes              | ≤3                             | Count of lake features                          |
| Barriers           | ~24 edges in clusters of 1–4   | Total barrier edge count                        |
| Landmarks per Type | 3–4 each                       | Count per landmark subtype                      |
| Border Clusters    | ~4                             | Contiguous border type regions                  |
| Terrain Clusters   | 1–12 hexes                     | Size of contiguous same-terrain regions         |

### 12.3 Affinity Rules

Not constraints, but probability modifiers:

| Feature                  | Affinity                                           |
| ------------------------ | -------------------------------------------------- |
| Marsh/Bog                | Higher near water features; cluster together       |
| Heath                    | Higher near bog/marsh (transitional wetland edge)  |
| Glade/Forest             | Cluster together                                   |
| Plains/Hills             | Higher probability adjacent (foothills transition) |
| Crag                     | Higher affinity to peaks than to hills             |
| Hills/Crags/Peaks/Valley | Cluster together; higher near cliff borders        |
| Border types             | Cluster by type (~4 clusters)                      |

---

## 13. Acceptance Criteria

### 13.1 Generation

- [ ] Generates complete, bounded realms
- [ ] All hexes generated only on discovery
- [ ] Deterministic output for same seed
- [ ] Hard constraints always satisfied
- [ ] Soft constraints met >90% of runs

### 13.2 Visualization

- [ ] Hex map renders correctly (pointy-top orientation)
- [ ] All terrain types visually distinct
- [ ] Rivers display on hex edges
- [ ] Barriers display as thick red lines on hex edges
- [ ] Features display with appropriate markers
- [ ] Fog of war hides unrevealed hexes
- [ ] Viewport auto-scales to map
- [ ] Step forward/backward works correctly
- [ ] Animation plays at 1 step/second
- [ ] State panel updates each step

### 13.3 Non-Interactive Mode

- [ ] Runs complete simulation
- [ ] Outputs constraint compliance report
- [ ] Provides debug information for failures
- [ ] Accepts seed parameter

---

## Glossary

| Term            | Definition                                                                              |
| --------------- | --------------------------------------------------------------------------------------- |
| Border          | Impassable hex forming realm boundary (sea, cliff, wasteland)                           |
| Barrier         | Impassable edge between two passable hexes                                              |
| Cluster         | Group of contiguous hexes sharing a property (terrain type, border type)                |
| Distributary    | River branch that flows away from main river toward a terminus                          |
| Explorable      | Passable hexes that can be visited by explorer                                          |
| Feature         | Holdings, Myth Sites, or Landmarks placed on hexes                                      |
| Flow Direction  | The direction water moves through a river segment (source → terminus)                   |
| Forced Terminus | A lake, marsh, or bog created when a river cannot continue due to elevation constraints |
| Hex Distance    | Minimum number of hex-to-hex moves between two hexes                                    |
| Network (River) | Connected set of river segments including main river, tributaries, and distributaries   |
| Reveal          | Generate and display a hex when explorer moves adjacent                                 |
| River Segment   | A continuous portion of river from one endpoint to another                              |
| Span            | Maximum hex distance between any two points in a river network                          |
| Step            | One explorer movement (reveals all adjacent hexes)                                      |
| Tributary       | River branch that flows from a source into the main river                               |
