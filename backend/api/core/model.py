from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field

VariableKind = Literal['fixed', 'continuous', 'quantized', 'discrete']
DistributionKind = Literal['constant', 'normal', 'lognormal', 'exponential', 'triangular', 'empirical', 'borrowed', 'unresolved']
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
    minimum_minutes: float | None = None
    mode_minutes: float | None = None
    maximum_minutes: float | None = None
    samples_minutes: list[float] | None = None
    source_activity_id: str | None = None
    scale: float = 1.0


class StaffingInterval(BaseModel):
    start_minute: float
    end_minute: float
    capacity: int
    label: str | None = None


class ArrivalInterval(BaseModel):
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
    model_source: str = 'configured'
    confidence: str = 'defined'
    terminal: bool = False
    required_skills: list[str] = Field(default_factory=list)
    eligible_resource_pools: list[str] = Field(default_factory=list)
    routing_policy: RoutingPolicy = 'fixed_pool'


class Transition(BaseModel):
    source: str
    target: str
    probability: float = 1.0
    # Optional observed evidence retained for on-demand statistical inspection.
    observed_count: int | None = None
    handoff_samples_minutes: list[float] | None = None


class ResourcePool(BaseModel):
    id: str
    name: str
    capacity: int = 1
    # Explicit resource cost makes calibrated models independent of demo-specific
    # activity naming. Existing models that omit it remain backward compatible.
    cost_per_hour: float | None = None
    skills: list[str] = Field(default_factory=list)
    staffing_profile: list[StaffingInterval] = Field(default_factory=list)


class Architecture(BaseModel):
    id: str
    name: str
    enabled_activities: list[str]
    transitions: list[Transition]


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
    arrival_profile: list[ArrivalInterval] = Field(default_factory=list)
    arrival_profile_repeat_minutes: float = 1440.0
    staffing_profile_repeat_minutes: float = 1440.0

    def activity_map(self):
        return {a.id: a for a in self.activities}

    def resource_map(self):
        return {r.id: r for r in self.resources}
