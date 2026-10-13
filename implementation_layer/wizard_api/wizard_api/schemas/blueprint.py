from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class BlueprintVersionSummary(BaseModel):
    version: int
    note: str
    created_at: datetime


class BlueprintContent(BaseModel):
    name: str = ""
    description: str = ""
    goal: str = ""
    steps: list[dict] = Field(default_factory=list)


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
