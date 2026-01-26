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

## 2. Hex Map Structure

### 2.1 Hex Configuration

| Property          | Specification                              |
| ----------------- | ------------------------------------------ |
| Orientation       | Pointy-topped                              |
| Coordinate System | Implementation choice (axial recommended)  |
| Adjacency         | 6 neighbors per hex (NE, E, SE, SW, W, NW) |

### 2.2 Realm Dimensions

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

## 3. Hex Types

### 3.1 Border Hexes (Impassable)

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

### 3.2 Passable Terrain Types

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

### 3.3 Elevation Hierarchy

Used exclusively for river flow logic:

```
Peaks (highest)
   ↓
Hills / Crags (mid)
   ↓
All other terrain (lowest)
```

---

## 4. Hex Edges

Each hex has 6 edges. Edges may have special properties.

### 4.1 River Edges

Rivers flow along hex edges (not through hex centers).

| Property           | Specification                                                   |
| ------------------ | --------------------------------------------------------------- |
| Networks per Realm | Generally 1 large network; rarely 0 or multiple small           |
| Flow Direction     | Determined when first discovered; maintained throughout network |
| Branches           | Networks may contain tributaries and distributaries             |

#### 4.1.1 River Origination

Rivers (and tributaries) must originate from one of:

| Source Type  | Description                                        |
| ------------ | -------------------------------------------------- |
| Cliff border | River emerges from cliff boundary                  |
| Peaks        | River starts at hex edge adjacent to peaks terrain |
| Lake         | River flows out of a lake                          |
| Marsh        | River emerges from marsh                           |
| Bog          | River emerges from bog                             |

**Note**: Sea borders and wasteland borders are NOT valid river sources. Rivers flow INTO seas, not out of them.

#### 4.1.2 River Termination

Rivers (and distributaries) must terminate at one of:

| Terminus Type | Description                          |
| ------------- | ------------------------------------ |
| Sea border    | River flows into sea                 |
| Cliff border  | River flows into/over cliff boundary |
| Lake          | River flows into a lake              |
| Bog           | River disperses into bog             |
| Marsh         | River disperses into marsh           |

**Note**: Wasteland borders are NOT valid river termini.

**Forced Terminus Placement**: If a river cannot continue due to elevation constraints (e.g., surrounded by hills/peaks it cannot enter) and no valid terminus terrain exists among revealed hexes, an unrevealed adjacent hex is **forced to become a valid terminus** (lake, marsh, or bog—randomly selected) to terminate the river. Forced lakes may violate the 3-lake soft constraint.

#### 4.1.3 Flow Direction

Flow direction is determined when a river is first discovered:

1. **Elevation-based**: If adjacent revealed hexes have different elevations, flow direction is set downhill (from higher to lower elevation)
2. **Random**: If no elevation difference exists, flow direction is randomly assigned

Once established:

- All extensions of the network must maintain flow from source(s) to terminus/termini
- Rivers may **meander freely** (change cardinal direction: E → SE → S → SW, etc.)
- The only constraint is logical flow continuity—water flows from source toward terminus

#### 4.1.4 Tributaries and Distributaries

River networks may branch:

| Branch Type  | Source                                                               | Terminus                                                           | Flow Direction             |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------- |
| Tributary    | Must follow river origination rules (cliff, peaks, lake, marsh, bog) | Joins another river in the network                                 | Flows toward main river    |
| Distributary | Branches from another river in the network                           | Must follow river termination rules (sea, cliff, lake, bog, marsh) | Flows away from main river |

**Branch Rules**:

- Cardinal direction is irrelevant—branches can flow any direction
- Tributaries and distributaries are part of the same network
- All branches must maintain logical flow (source → terminus)

#### 4.1.5 Elevation Constraints

| River Origin                                | Can Enter Peaks? | Can Enter Hills? |
| ------------------------------------------- | ---------------- | ---------------- |
| Originates at/adjacent to Peaks             | Yes              | Yes              |
| Originates at/adjacent to Hills (not Peaks) | No               | Yes              |
| Originates elsewhere                        | No               | No               |

**Elevation Violation Handling**: If a river has no valid edges to continue (all adjacent unrevealed hexes would violate elevation rules), force an adjacent unrevealed hex to become a valid terminus.

#### 4.1.6 River Network Size Constraint

The goal is typically one large river with tributaries/distributaries cutting across the map center, though randomness may produce different outcomes.

| Metric          | Definition                                                      |
| --------------- | --------------------------------------------------------------- |
| Primary Network | The largest connected river network in the realm                |
| Network Span    | Maximum hex distance between any two river edges in the network |
| Map Diagonal    | Approximate diagonal of explorable area (~17 hexes for 12×12)   |

**Target**: Primary network span ≥ 50% of map diagonal (~8+ hexes)

**Falsifiable Constraint** (soft):

- SUCCESS: Largest river network has span ≥ 8 hexes
- PARTIAL: Largest river network has span 4–7 hexes
- MINIMAL: Total river edges < 10 OR largest network span < 4 hexes

#### 4.1.7 River Generation Behavior

**Probability Adjustment Based on Network Span**:

Until primary network span reaches threshold OR no river exists:

- New river origination: LOW probability (prefer extending existing)
- River termination: LOW probability (prefer continuing)
- Tributary/distributary branching: LOW probability

After primary network span reaches threshold:

- New river origination: NORMAL probability (allows small secondary networks)
- River termination: NORMAL probability
- Tributary/distributary branching: NORMAL probability

### 4.2 Barrier Edges

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

## 5. Water Features

### 5.1 Lakes

| Property      | Specification                 |
| ------------- | ----------------------------- |
| Maximum Count | 3 per realm (soft constraint) |
| Size          | 1–6 contiguous hexes (random) |
| Placement     | No constraints                |

**Lake Rules**:

- Multi-hex water features discovered during exploration
- Count toward water features for marsh/bog affinity
- Can serve as river source or terminus

### 5.2 Seas

Seas are border hexes (see Section 3.1). They also count as water features for terrain affinity calculations. Rivers can terminate at sea but cannot originate from sea.

---

## 6. Features

Features are placed on passable terrain hexes. Features do not overlap (one feature per hex maximum).

### 6.1 Feature Placement Probability

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

### 6.2 Holdings

| Property         | Specification                              |
| ---------------- | ------------------------------------------ |
| Count            | Exactly 4 per realm                        |
| Spacing          | Minimum 4 hex distance between Holdings    |
| River Adjacency  | Allowed (can be on hexes with river edges) |
| Boundary Spacing | No constraint                              |

### 6.3 Myth Sites

| Property  | Specification       |
| --------- | ------------------- |
| Count     | Exactly 6 per realm |
| Placement | No constraints      |

### 6.4 Landmarks

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

## 7. Generation Dependencies

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

## 8. Exploration Simulation

### 8.1 Explorer Behavior

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

### 8.2 Simulation Parameters

| Parameter       | Description                                                 |
| --------------- | ----------------------------------------------------------- |
| `seed`          | Random seed for deterministic generation                    |
| `startAtBorder` | Boolean: if true, explorer starts adjacent to a border tile |

**Starting Location**:

- If `startAtBorder = false`: random placement anywhere
- If `startAtBorder = true`: placed adjacent to a border tile
- Starting location is generated (not predetermined)

---

## 9. Visualization Requirements

### 9.1 Interactive JSX Component

**User Controls**:

| Control                | Function                         |
| ---------------------- | -------------------------------- |
| Seed Input             | Edit simulation seed             |
| Start at Border Toggle | Enable/disable border start      |
| Step Forward           | Advance one explorer movement    |
| Step Backward          | Revert to previous state         |
| Play/Pause             | Toggle animation (1 step/second) |
| Reset                  | Return to initial state          |

### 9.2 Map Display

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

### 9.3 State Display

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

## 10. Non-Interactive Mode

For algorithm verification and debugging.

### 10.1 Execution

- Run complete simulation programmatically
- Accept seed parameter
- Generate full realm without visualization

### 10.2 Output

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

## 11. Constraint Summary

### 11.1 Hard Constraints

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

#### 11.1.1 Explorer Never Trapped Constraint

The explorer must never be placed in a situation where all adjacent hexes are impassable. This constraint is enforced during generation:

**Impassable Conditions**:

- Border hexes (sea, cliff, wasteland)
- Lake hexes
- Hexes blocked by barrier edges on all accessible sides

**Enforcement Rules**:

1. **Barrier Placement**: Before placing a barrier edge, verify it would not create an isolated region
2. **Lake Placement**: Before converting a hex to a lake, verify it would not trap the explorer
3. **Border Generation**: Border closure must leave sufficient connectivity for full exploration

**Validation**: At any step during exploration, the explorer must have ≥1 valid move to an explorable hex. If the generator would create a trap, it must:

- Skip the barrier/lake placement, OR
- Choose an alternative configuration

**Rationale**: A trapped explorer cannot complete realm exploration, violating the core gameplay loop. This constraint ensures 100% of generated maps are fully explorable.

### 11.2 Soft Constraints

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

### 11.3 Affinity Rules

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

## 12. Acceptance Criteria

### 14.1 Generation

- [ ] Generates complete, bounded realms
- [ ] All hexes generated only on discovery
- [ ] Deterministic output for same seed
- [ ] Hard constraints always satisfied
- [ ] Soft constraints met >90% of runs

### 14.2 Visualization

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

### 14.3 Non-Interactive Mode

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
