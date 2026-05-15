"""Controlled loyalty-program sample data.

This generator deliberately creates a small but realistic loyalty programme:

  tiers        — 4 membership tiers
  merchants    — 9 merchant partners
  members      — 36 members, split into 3 clear behavioural personas
  transactions — 96 purchases
  rewards      — 24 redemptions

The three personas are intentionally separable for local LLM testing:

  new_casual          Low tier, recent joins, low engagement
  steady_core         Silver/Gold, steady usage, moderate engagement
  high_value_champion Gold/Platinum, high engagement, premium spend

All generation is seeded. The randomness is controlled by persona-level
distributions, so values feel plausible without becoming noisy mush.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

RNG = np.random.default_rng(42)


COLUMN_DESCRIPTIONS: dict[str, dict[str, str]] = {
    "tiers": {
        "tier_id": "Stable tier key used by members.tier_id.",
        "tier_name": "Human-readable loyalty tier name.",
        "min_points": "Minimum lifetime points needed for the tier.",
        "max_points": "Maximum lifetime points before the next tier.",
        "multiplier": "Points earning multiplier applied to eligible purchases.",
        "benefits": "Short description of tier benefits.",
    },
    "merchants": {
        "merchant_id": "Stable merchant key used by transactions.merchant_id.",
        "merchant_name": "Partner merchant display name.",
        "category": "Retail category such as grocery, travel, fashion, or electronics.",
        "region": "Operating region used for partner coverage analysis.",
        "bonus_multiplier": "Merchant-specific promotional points multiplier.",
        "active": "Whether the merchant is currently active in the programme.",
    },
    "members": {
        "member_id": "Stable customer/member key used by transactions and rewards.",
        "member_name": "Member display name for sample UI inspection.",
        "tier_id": "Current loyalty tier. Joins to tiers.tier_id.",
        "joined_date": "Date the member enrolled in the loyalty programme.",
        "lifecycle_status": "Lifecycle/persona status used for programme operations.",
        "engagement_score": "0-100 score summarising recent app, purchase, and reward engagement.",
    },
    "transactions": {
        "transaction_id": "Stable purchase key.",
        "member_id": "Member who made the purchase. Joins to members.member_id.",
        "merchant_id": "Merchant where the purchase occurred. Joins to merchants.merchant_id.",
        "amount": "Purchase amount in dollars.",
        "points_earned": "Loyalty points earned from the transaction.",
        "transaction_date": "Date of purchase.",
    },
    "rewards": {
        "reward_id": "Stable reward redemption key.",
        "member_id": "Member who redeemed or reserved the reward. Joins to members.member_id.",
        "reward_type": "Reward category such as cashback, voucher, travel, or experience.",
        "points_cost": "Points cost of the reward.",
        "redeemed_at": "Date the reward was redeemed, reserved, or expired.",
        "status": "Reward lifecycle state.",
    },
}


TIERS = pd.DataFrame([
    {"tier_id": 1, "tier_name": "Bronze", "min_points": 0, "max_points": 4_999, "multiplier": 1.0, "benefits": "Basic rewards access"},
    {"tier_id": 2, "tier_name": "Silver", "min_points": 5_000, "max_points": 14_999, "multiplier": 1.3, "benefits": "Free delivery and seasonal vouchers"},
    {"tier_id": 3, "tier_name": "Gold", "min_points": 15_000, "max_points": 49_999, "multiplier": 1.8, "benefits": "Priority support and exclusive offers"},
    {"tier_id": 4, "tier_name": "Platinum", "min_points": 50_000, "max_points": 999_999, "multiplier": 2.5, "benefits": "VIP events and concierge rewards"},
])


MERCHANTS = pd.DataFrame([
    ("M01", "FreshBasket", "Grocery", "North", 1.0, True),
    ("M02", "TechZone", "Electronics", "South", 1.5, True),
    ("M03", "StyleHub", "Fashion", "East", 1.2, True),
    ("M04", "GreenEats", "Restaurant", "West", 1.0, True),
    ("M05", "SportsPeak", "Sports", "North", 1.3, True),
    ("M06", "HomeCraft", "Home", "Central", 1.0, True),
    ("M07", "LuxeTravel", "Travel", "East", 2.0, True),
    ("M08", "PharmaCare", "Health", "West", 1.0, True),
    ("M09", "BooksWorld", "Books", "South", 1.1, True),
], columns=["merchant_id", "merchant_name", "category", "region", "bonus_multiplier", "active"])


PERSONAS = [
    {
        "name": "new_casual",
        "count": 12,
        "tier_choices": [1, 1, 1, 2],
        "status": "new_casual",
        "join_start": "2024-01-01",
        "join_end": "2024-12-31",
        "engagement": (18, 7),
        "tx_count": (1, 3),
        "amount": (18, 8),
        "merchants": ["M01", "M04", "M08", "M09"],
        "reward_prob": 0.15,
    },
    {
        "name": "steady_core",
        "count": 12,
        "tier_choices": [2, 2, 3, 3],
        "status": "steady_core",
        "join_start": "2021-01-01",
        "join_end": "2023-06-30",
        "engagement": (55, 8),
        "tx_count": (2, 4),
        "amount": (58, 18),
        "merchants": ["M01", "M03", "M04", "M05", "M06"],
        "reward_prob": 0.55,
    },
    {
        "name": "high_value_champion",
        "count": 12,
        "tier_choices": [3, 4, 4, 4],
        "status": "high_value_champion",
        "join_start": "2018-01-01",
        "join_end": "2021-12-31",
        "engagement": (86, 6),
        "tx_count": (3, 6),
        "amount": (185, 55),
        "merchants": ["M02", "M03", "M05", "M07"],
        "reward_prob": 0.85,
    },
]

FIRST_NAMES = [
    "Asha", "Ben", "Cara", "Dev", "Elena", "Farah", "Gavin", "Hana", "Ishan",
    "Jules", "Kai", "Leah", "Mira", "Noah", "Omar", "Priya", "Rina", "Sam",
]
LAST_NAMES = [
    "Shah", "Morgan", "Chen", "Iyer", "Reed", "Patel", "Brooks", "Khan",
    "Nair", "Stone", "Mehta", "Roy",
]
REWARD_TYPES = ["Cashback", "Voucher", "Travel Upgrade", "Partner Miles", "VIP Experience"]


def _rand_date(start: str, end: str, n: int) -> list[str]:
    s = np.datetime64(start)
    e = np.datetime64(end)
    days = int((e - s) / np.timedelta64(1, "D"))
    offsets = RNG.integers(0, days + 1, size=n)
    return [(s + np.timedelta64(int(d), "D")).astype("datetime64[D]").astype(str) for d in offsets]


def generate_members() -> pd.DataFrame:
    rows: list[dict] = []
    seq = 1
    for persona in PERSONAS:
        joined = _rand_date(persona["join_start"], persona["join_end"], persona["count"])
        for i in range(persona["count"]):
            first = FIRST_NAMES[(seq + i) % len(FIRST_NAMES)]
            last = LAST_NAMES[(seq * 2 + i) % len(LAST_NAMES)]
            score = int(np.clip(RNG.normal(*persona["engagement"]), 1, 99))
            rows.append({
                "member_id": f"MBR{seq:04d}",
                "member_name": f"{first} {last}",
                "tier_id": int(RNG.choice(persona["tier_choices"])),
                "joined_date": joined[i],
                "lifecycle_status": persona["status"],
                "engagement_score": score,
            })
            seq += 1
    return pd.DataFrame(rows)


def generate_transactions(members: pd.DataFrame) -> pd.DataFrame:
    tier_multiplier = dict(zip(TIERS["tier_id"], TIERS["multiplier"]))
    merchant_multiplier = dict(zip(MERCHANTS["merchant_id"], MERCHANTS["bonus_multiplier"]))
    persona_by_member = dict(zip(members["member_id"], members["lifecycle_status"]))
    tier_by_member = dict(zip(members["member_id"], members["tier_id"]))

    persona_cfg = {p["name"]: p for p in PERSONAS}
    rows: list[dict] = []
    seq = 1
    for member_id in members["member_id"]:
        cfg = persona_cfg[persona_by_member[member_id]]
        n_tx = int(RNG.integers(cfg["tx_count"][0], cfg["tx_count"][1] + 1))
        dates = _rand_date("2024-01-01", "2024-12-31", n_tx)
        for date in dates:
            merchant_id = str(RNG.choice(cfg["merchants"]))
            amount = float(np.clip(RNG.normal(*cfg["amount"]), 6, 600))
            points = int(round(amount * tier_multiplier[tier_by_member[member_id]] * merchant_multiplier[merchant_id]))
            rows.append({
                "transaction_id": f"TXN{seq:05d}",
                "member_id": member_id,
                "merchant_id": merchant_id,
                "amount": round(amount, 2),
                "points_earned": points,
                "transaction_date": date,
            })
            seq += 1
    while len(rows) < 96:
        member = members.sample(1, random_state=int(RNG.integers(0, 1_000_000))).iloc[0]
        cfg = persona_cfg[member["lifecycle_status"]]
        merchant_id = str(RNG.choice(cfg["merchants"]))
        amount = float(np.clip(RNG.normal(*cfg["amount"]), 6, 600))
        points = int(round(amount * tier_multiplier[int(member["tier_id"])] * merchant_multiplier[merchant_id]))
        rows.append({
            "transaction_id": f"TXN{seq:05d}",
            "member_id": member["member_id"],
            "merchant_id": merchant_id,
            "amount": round(amount, 2),
            "points_earned": points,
            "transaction_date": _rand_date("2024-01-01", "2024-12-31", 1)[0],
        })
        seq += 1
    return pd.DataFrame(rows).head(96)


def generate_rewards(members: pd.DataFrame) -> pd.DataFrame:
    persona_cfg = {p["name"]: p for p in PERSONAS}
    rows: list[dict] = []
    seq = 1
    for _, member in members.iterrows():
        cfg = persona_cfg[member["lifecycle_status"]]
        if RNG.random() > cfg["reward_prob"]:
            continue
        tier = int(member["tier_id"])
        reward_type = str(RNG.choice(REWARD_TYPES if tier >= 3 else REWARD_TYPES[:3]))
        base_cost = {1: 700, 2: 1800, 3: 4200, 4: 8500}[tier]
        status = str(RNG.choice(["redeemed", "pending", "expired"], p=[0.75, 0.18, 0.07]))
        rows.append({
            "reward_id": f"RWD{seq:04d}",
            "member_id": member["member_id"],
            "reward_type": reward_type,
            "points_cost": int(np.clip(RNG.normal(base_cost, base_cost * 0.22), 300, 15000)),
            "redeemed_at": _rand_date("2024-02-01", "2024-12-31", 1)[0],
            "status": status,
        })
        seq += 1
    premium = members[members["tier_id"].isin([3, 4])]
    while len(rows) < 24:
        member = premium.sample(1, random_state=int(RNG.integers(0, 1_000_000))).iloc[0]
        tier = int(member["tier_id"])
        base_cost = {3: 4200, 4: 8500}[tier]
        rows.append({
            "reward_id": f"RWD{seq:04d}",
            "member_id": member["member_id"],
            "reward_type": str(RNG.choice(REWARD_TYPES[2:])),
            "points_cost": int(np.clip(RNG.normal(base_cost, base_cost * 0.22), 1200, 15000)),
            "redeemed_at": _rand_date("2024-02-01", "2024-12-31", 1)[0],
            "status": str(RNG.choice(["redeemed", "pending"], p=[0.82, 0.18])),
        })
        seq += 1
    return pd.DataFrame(rows).head(24)


def generate_all() -> dict[str, pd.DataFrame]:
    members = generate_members()
    return {
        "tiers": TIERS,
        "merchants": MERCHANTS,
        "members": members,
        "transactions": generate_transactions(members),
        "rewards": generate_rewards(members),
    }


def save_csvs(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, df in generate_all().items():
        path = out_dir / f"{name}.csv"
        df.to_csv(path, index=False)
        print(f"  wrote {path} ({len(df)} rows)")


if __name__ == "__main__":
    save_csvs(Path(__file__).parents[2] / "sample_data" / "loyalty")
