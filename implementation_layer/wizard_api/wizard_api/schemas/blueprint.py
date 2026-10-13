from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class BlueprintVersionSummary(BaseModel):
    version: int
    note: str
    created_at: datetime


class BlueprintContent(BaseModel):
    """V2 session blueprint. Extra BPMN sync fields are persisted in JSONB."""

    name: str = ""
    description: str = ""
    goal: str = ""
    steps: list[dict] = Field(default_factory=list)
    # Populated by BPMN canvas sync (#34 / #48) — data-object label overrides.
    data_objects: dict[str, str] = Field(default_factory=dict)
    # Exclusive/parallel gateway snapshots from canvas (#48).
    gateways: list[dict] = Field(default_factory=list)
    # Persistent repositories → BPMN dataStoreReference (+ send task) via V1 generator.
    integration_targets: list[str] = Field(default_factory=list)


class SessionDetailResponse(BaseModel):
    """Full session state for UI resume (S1-2 + metadata)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    title: str
    step: int
    status: str
    gate_statuses: dict[str, str]
    metadata: dict
    output_dir: str
    active_version: int
    versions: list[BlueprintVersionSummary]
    blueprint: BlueprintContent
    messages: list[dict]
    created_at: datetime
    updated_at: datetime
