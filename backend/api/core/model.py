from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field

VariableKind = Literal['fixed', 'continuous', 'quantized', 'discrete']
DistributionKind = Literal['constant', 'normal', 'lognormal', 'exponential', 'empirical', 'triangular']
RoutingPolicy = Literal['fixed_pool', 'earliest_available_skill']


class DesignVariable(BaseModel):
    name: str
    kind: VariableKind
    lower: float | None = None
    upper: float | None = None
    step: float | None = None
    choices: list[str] | None = None
    value: float | str

    def numeric_project(self, value: float) -> float:
        if self.kind not in ('continuous', 'quantized'):
            raise ValueError(f'{self.name} is not numeric')
        if self.lower is None or self.upper is None:
            raise ValueError(f'{self.name} requires bounds')
        value = min(self.upper, max(self.lower, float(value)))
        if self.kind == 'quantized':
            if not self.step or self.step <= 0:
                raise ValueError('step must be positive')
            value = self.lower + round((value - self.lower) / self.step) * self.step
            value = min(self.upper, max(self.lower, value))
        return float(value)


class ServiceTime(BaseModel):
    distribution: DistributionKind = 'lognormal'
    mean_minutes: float = 30.0
    std_minutes: float = 10.0
    samples_minutes: list[float] | None = None
    min_minutes: float | None = None
    mode_minutes: float | None = None
    max_minutes: float | None = None
    sample_count: int | None = None
    confidence: Literal['high', 'moderate', 'low', 'insufficient'] | None = None
    fallback_reason: str | None = None


class StaffingInterval(BaseModel):
    """Capacity available during one interval in a repeating staffing profile."""
    start_minute: float
    end_minute: float
    capacity: int
    label: str | None = None


class ArrivalInterval(BaseModel):
    """Piecewise-constant arrival rate during a repeating time profile."""
    start_minute: float
    end_minute: float
    rate_per_hour: float
    label: str | None = None


class Activity(BaseModel):
    id: str
    name: str
    resource_pool: str | None = None
    service_time: ServiceTime = Field(default_factory=ServiceTime)
    cost_per_hour: float = 75.0

    # Skill-based routing is opt-in. Existing models continue to use resource_pool.
    required_skills: list[str] = Field(default_factory=list)
    eligible_resource_pools: list[str] = Field(default_factory=list)
    routing_policy: RoutingPolicy = 'fixed_pool'


class Transition(BaseModel):
    source: str
    target: str
    probability: float = 1.0


class ResourcePool(BaseModel):
    id: str
    name: str
    capacity: int = 1
    cost_per_hour: float | None = None

    # Pools can advertise multiple skills; an activity may then choose among all
    # pools whose skill set covers the activity's required_skills.
    skills: list[str] = Field(default_factory=list)

    # If present, this profile replaces constant staffing for simulation. The
    # profile repeats every ProcessModel.staffing_profile_repeat_minutes.
    staffing_profile: list[StaffingInterval] = Field(default_factory=list)


class Architecture(BaseModel):
    id: str
    name: str
    enabled_activities: list[str]
    transitions: list[Transition]




class WorkType(BaseModel):
    """Transaction/job/product class used by operating-structure experiments."""
    id: str
    name: str
    probability: float = 1.0
    preferred_cell_id: str | None = None


class CellDefinition(BaseModel):
    """Manual organizational cell definition.

    Activities may appear in more than one cell.  In Phase 1 each resource should
    belong to at most one cell; the experiment validator enforces that rule.
    """
    id: str
    name: str
    activity_ids: list[str] = Field(default_factory=list)
    resource_ids: list[str] = Field(default_factory=list)
    # Optional per-pool capacity allocation. This lets a resource pool be split
    # across multiple cells without creating duplicate resource objects.
    resource_capacities: dict[str, int] = Field(default_factory=dict)
    preferred_work_types: list[str] = Field(default_factory=list)
    capacity_limit: int | None = None
    cross_cell_eligible: bool = False


class ProcessModel(BaseModel):
    workflow_class: Literal['general', 'contact_center'] = 'general'
    id: str = 'process-1'
    name: str = 'Process Model'
    start_activity: str
    end_activity: str
    activities: list[Activity]
    resources: list[ResourcePool]
    architectures: list[Architecture]
    variables: list[DesignVariable]
    arrival_rate_per_hour: float = 6.0
    sla_minutes: float = 480.0

    # Optional piecewise-constant non-stationary arrival process. When empty,
    # arrival_rate_per_hour is used exactly as before.
    arrival_profile: list[ArrivalInterval] = Field(default_factory=list)
    arrival_profile_repeat_minutes: float = 1440.0

    # Staffing profiles on resource pools repeat over this horizon.
    staffing_profile_repeat_minutes: float = 1440.0

    # Optional organizational structures used by cellularization experiments.
    # They do not change the process architecture unless a simulation scenario
    # explicitly selects a cellular operating mode.
    work_types: list[WorkType] = Field(default_factory=list)
    cells: list[CellDefinition] = Field(default_factory=list)

    def activity_map(self):
        return {a.id: a for a in self.activities}

    def resource_map(self):
        return {r.id: r for r in self.resources}
