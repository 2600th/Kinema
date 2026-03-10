import * as THREE from 'three';
import { crowd } from 'navcat/blocks';
import {
  type NavMesh,
  type Vec3,
  type QueryFilter,
  findRandomPoint,
  findNearestPoly,
  createFindNearestPolyResult,
  createDefaultQueryFilter,
} from 'navcat';
import { NavAgent } from './NavAgent';

/** Maximum attempts for findRandomPoint (reservoir sampling can fail). */
const RANDOM_POINT_MAX_RETRIES = 8;

export class NavPatrolSystem {
  private crowdInstance: crowd.Crowd;
  private agents: Array<{ navAgent: NavAgent; crowdAgentId: string }> = [];
  private queryFilter: QueryFilter;
  private nearestPolyResult = createFindNearestPolyResult();

  constructor(
    private scene: THREE.Scene,
    private navMesh: NavMesh,
    agentCount: number,
    reachableFilter?: QueryFilter | null,
  ) {
    // Use the reachable-only filter when available so agents never target
    // disconnected islands (obstacle tops, etc.).
    this.queryFilter = reachableFilter ?? createDefaultQueryFilter();
    this.crowdInstance = crowd.create(0.5);
    this.spawnAgents(agentCount);
  }

  /**
   * Try findRandomPoint up to RANDOM_POINT_MAX_RETRIES times.
   * Returns null if all attempts fail (extremely unlikely with enough retries).
   */
  private tryFindRandomPoint(): { position: Vec3; nodeRef: number } | null {
    for (let i = 0; i < RANDOM_POINT_MAX_RETRIES; i++) {
      const result = findRandomPoint(this.navMesh, this.queryFilter, Math.random);
      if (result.success) return result;
    }
    return null;
  }

  private spawnAgents(count: number): void {
    for (let i = 0; i < count; i++) {
      const randomResult = this.tryFindRandomPoint();
      if (!randomResult) {
        console.warn(`[NavPatrolSystem] Could not find spawn point for agent ${i} after ${RANDOM_POINT_MAX_RETRIES} retries`);
        continue;
      }

      const pos = randomResult.position;
      const navAgent = new NavAgent(this.scene, new THREE.Vector3(pos[0], pos[1], pos[2]));

      const agentId = crowd.addAgent(this.crowdInstance, this.navMesh, pos, {
        radius: 0.25,
        height: 1.0,
        maxAcceleration: 4.0,
        maxSpeed: 2.0,
        collisionQueryRange: 2.5,
        separationWeight: 2.0,
        updateFlags:
          crowd.CrowdUpdateFlags.ANTICIPATE_TURNS |
          crowd.CrowdUpdateFlags.OBSTACLE_AVOIDANCE |
          crowd.CrowdUpdateFlags.SEPARATION |
          crowd.CrowdUpdateFlags.OPTIMIZE_VIS |
          crowd.CrowdUpdateFlags.OPTIMIZE_TOPO,
        queryFilter: this.queryFilter,
      });

      this.agents.push({ navAgent, crowdAgentId: agentId });
      this.setRandomTarget(agentId);
    }
  }

  private setRandomTarget(agentId: string): void {
    const randomResult = this.tryFindRandomPoint();
    if (!randomResult) return;
    crowd.requestMoveTarget(
      this.crowdInstance,
      agentId,
      randomResult.nodeRef,
      randomResult.position,
    );
  }

  update(dt: number): void {
    crowd.update(this.crowdInstance, this.navMesh, dt);

    for (const { navAgent, crowdAgentId } of this.agents) {
      const agent = this.crowdInstance.agents[crowdAgentId];
      if (!agent) continue;

      const pos = agent.position;
      navAgent.updatePosition({ x: pos[0], y: pos[1], z: pos[2] });

      // Update path visualization from crowd corridor corners
      if (agent.corners.length > 0) {
        const points = agent.corners.map((c) => ({
          x: c.position[0],
          y: c.position[1],
          z: c.position[2],
        }));
        navAgent.updatePathVisualization(this.scene, points);
      }

      if (crowd.isAgentAtTarget(this.crowdInstance, crowdAgentId, 1.0)) {
        this.setRandomTarget(crowdAgentId);
      }
    }
  }

  requestTargetForNearest(worldPos: THREE.Vector3): NavAgent | null {
    let closest: { agentId: string; dist: number; navAgent: NavAgent } | null = null;

    for (const { navAgent, crowdAgentId } of this.agents) {
      const dist = navAgent.mesh.position.distanceTo(worldPos);
      if (!closest || dist < closest.dist) {
        closest = { agentId: crowdAgentId, dist, navAgent };
      }
    }

    if (!closest) return null;

    const targetPos: Vec3 = [worldPos.x, worldPos.y, worldPos.z];
    findNearestPoly(
      this.nearestPolyResult,
      this.navMesh,
      targetPos,
      [2, 4, 2],
      this.queryFilter,
    );

    if (this.nearestPolyResult.success) {
      crowd.requestMoveTarget(
        this.crowdInstance,
        closest.agentId,
        this.nearestPolyResult.nodeRef,
        this.nearestPolyResult.position,
      );
      return closest.navAgent;
    }
    return null;
  }

  dispose(): void {
    for (const { navAgent, crowdAgentId } of this.agents) {
      crowd.removeAgent(this.crowdInstance, crowdAgentId);
      navAgent.dispose(this.scene);
    }
    this.agents = [];
  }
}
