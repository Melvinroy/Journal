"""Server-owned execution capabilities. Live operation has no enabled policy."""
LIMITS = {"sharesPerCampaign": 3, "campaigns": 2, "entryNotional": 500,
          "plannedRiskPerCampaign": 10, "totalPlannedRisk": 20}
CAPABILITIES = {"version": 1, "environment": "paper", "liveEnabled": False,
                "directions": ["Long"], "methods": ["Limit", "Normal", "Breakout"],
                "durations": ["DAY"], "sessions": ["Regular", "RegularExtended"],
                "excludedSymbols": ["PL", "AMD"], "limits": LIMITS}
