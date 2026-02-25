import * as THREE from 'three';
import { crowd } from 'navcat/blocks';
import {
  type NavMesh,
  type Vec3,
  findRandomPoint,
  findNearestPoly,
  createFindNearestPolyResult,
  createDefaultQueryFilter,
} from 'navcat';
import { NavAgent } from './NavAgent';

export class NavPatrolSystem {
  private crowdInstance: crowd.Crowd;
  private agents: Array<{ navAgent: NavAgent; crowdAgentId: string }> = [];
  private queryFilter = createDefaultQueryFilter();
  private nearestPolyResult = createFindNearestPolyResult();

  constructor(
    private scene: THREE.Scene,
    private navMesh: NavMesh,
    agentCount: number,
  ) {
    this.crowdInstance = crowd.create(0.5);
    this.spawnAgents(agentCount);
  }

  private spawnAgents(count: number): void {
    for (let i = 0; i < count; i++) {
      const randomResult = findRandomPoint(this.navMesh, this.queryFilter, Math.random);
      if (!randomResult.success) continue;

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
    const randomResult = findRandomPoint(this.navMesh, this.queryFilter, Math.random);
    if (!randomResult.success) return;
    crowd.requestMoveTarget(
      this.crowdInstance,
      agentId,
      randomResult.nodeRef,
      randomResult.position,
    );
  }

  private static vec3ToObj(v: Vec3): { x: number; y: number; z: number } {
    return { x: v[0], y: v[1], z: v[2] };
  }

  update(dt: number): void {
    crowd.update(this.crowdInstance, this.navMesh, dt);

    for (const { navAgent, crowdAgentId } of this.agents) {
      const agent = this.crowdInstance.agents[crowdAgentId];
      if (!agent) continue;

      navAgent.updatePosition(NavPatrolSystem.vec3ToObj(agent.position));

      if (crowd.isAgentAtTarget(this.crowdInstance, crowdAgentId, 1.0)) {
        this.setRandomTarget(crowdAgentId);
      }
    }
  }

  requestTargetForNearest(worldPos: THREE.Vector3): void {
    let closest: { agentId: string; dist: number } | null = null;

    for (const { navAgent, crowdAgentId } of this.agents) {
      const dist = navAgent.mesh.position.distanceTo(worldPos);
      if (!closest || dist < closest.dist) {
        closest = { agentId: crowdAgentId, dist };
      }
    }

    if (!closest) return;

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
    }
  }

  dispose(): void {
    for (const { navAgent } of this.agents) {
      navAgent.dispose(this.scene);
    }
    this.agents = [];
  }
}
