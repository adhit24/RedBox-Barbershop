-- ── xp_to_level: Level N requires 150*N² cumulative XP ──────────
CREATE OR REPLACE FUNCTION xp_to_level(p_total_xp INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(1, FLOOR(SQRT(p_total_xp::FLOAT / 150.0))::INTEGER);
$$;

-- ── get_level_title ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_level_title(p_level INTEGER, p_prestige INTEGER DEFAULT 0)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  base  TEXT;
  stars TEXT := repeat('★', LEAST(p_prestige, 3));
BEGIN
  base := CASE
    WHEN p_level >= 50 AND p_prestige >= 3 THEN 'Immortal Barber 👑'
    WHEN p_level >= 50 THEN 'Mythic Barber 💎'
    WHEN p_level >= 40 THEN 'Legend Barber ⭐'
    WHEN p_level >= 30 THEN 'Grandmaster Barber 🔴'
    WHEN p_level >= 20 THEN 'Master Barber 🟠'
    WHEN p_level >= 15 THEN 'Elite Barber 🟣'
    WHEN p_level >= 10 THEN 'Skilled Barber 🔵'
    WHEN p_level >= 5  THEN 'Junior Barber 🟢'
    ELSE                    'Rookie ⚪'
  END;
  RETURN CASE WHEN stars <> '' THEN stars || ' ' || base ELSE base END;
END;
$$;

-- ── add_xp: adds XP, levels up, updates title, writes feed ──────
CREATE OR REPLACE FUNCTION add_xp(
  p_barber_id TEXT,
  p_xp        INTEGER,
  p_reason    TEXT DEFAULT 'unknown'
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  rec         barber_xp%ROWTYPE;
  new_total   INTEGER;
  new_level   INTEGER;
  old_level   INTEGER;
  actual_xp   INTEGER;
  prev_level_xp INTEGER;
  leveled_up  BOOLEAN := false;
  b_name      TEXT;
  b_branch    TEXT;
BEGIN
  INSERT INTO barber_xp (barber_id) VALUES (p_barber_id)
  ON CONFLICT (barber_id) DO NOTHING;

  SELECT * INTO rec FROM barber_xp WHERE barber_id = p_barber_id;
  actual_xp := ROUND(p_xp * rec.xp_multiplier)::INTEGER;
  old_level  := rec.level;
  new_total  := rec.total_xp + actual_xp;
  new_level  := xp_to_level(new_total);
  leveled_up := new_level > old_level;
  prev_level_xp := 150 * (new_level - 1) * (new_level - 1);

  UPDATE barber_xp SET
    total_xp   = new_total,
    current_xp = new_total - prev_level_xp,
    level      = new_level,
    updated_at = now()
  WHERE barber_id = p_barber_id;

  INSERT INTO barber_xp_log (barber_id, xp_delta, reason, total_after)
  VALUES (p_barber_id, actual_xp, p_reason, new_total);

  IF leveled_up THEN
    SELECT name, branch INTO b_name, b_branch FROM barbers WHERE id = p_barber_id;

    INSERT INTO barber_titles (barber_id, level_title, active_title)
    VALUES (p_barber_id, get_level_title(new_level, rec.prestige), get_level_title(new_level, rec.prestige))
    ON CONFLICT (barber_id) DO UPDATE SET
      level_title = get_level_title(new_level, rec.prestige),
      active_title = CASE
        WHEN barber_titles.special_title IS NULL
          THEN get_level_title(new_level, rec.prestige)
        ELSE barber_titles.active_title
      END,
      updated_at = now();

    INSERT INTO barber_social_feed
      (event_type, barber_id, barber_name, branch, title, body, emoji, metadata)
    VALUES (
      'level_up', p_barber_id, b_name, b_branch,
      b_name || ' naik ke Level ' || new_level,
      'Sekarang: ' || get_level_title(new_level, rec.prestige),
      '🚀',
      jsonb_build_object('level', new_level, 'old_level', old_level)
    );
  END IF;

  RETURN jsonb_build_object(
    'xp_added', actual_xp, 'total_xp', new_total,
    'level', new_level, 'leveled_up', leveled_up
  );
END;
$$;

-- ── unlock_achievement: idempotent, awards XP, writes feed ──────
CREATE OR REPLACE FUNCTION unlock_achievement(
  p_barber_id TEXT,
  p_badge_key TEXT,
  p_label     TEXT,
  p_rarity    TEXT DEFAULT 'common'
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  xp_map     JSONB := '{"common":25,"rare":50,"epic":100,"legendary":250,"mythic":500}';
  xp_reward  INTEGER;
  b_name     TEXT;
  b_branch   TEXT;
  emoji_map  JSONB := '{"mythic":"💎","legendary":"🏆","epic":"🔥","rare":"⭐","common":"🎖️"}';
BEGIN
  IF EXISTS (
    SELECT 1 FROM barber_achievements
    WHERE barber_id = p_barber_id AND badge_key = p_badge_key
  ) THEN RETURN false; END IF;

  xp_reward := (xp_map ->> p_rarity)::INTEGER;

  INSERT INTO barber_achievements (barber_id, badge_key, rarity, xp_awarded, label)
  VALUES (p_barber_id, p_badge_key, p_rarity, xp_reward, p_label);

  PERFORM add_xp(p_barber_id, xp_reward, 'achievement_' || p_badge_key);

  SELECT name, branch INTO b_name, b_branch FROM barbers WHERE id = p_barber_id;

  INSERT INTO barber_social_feed
    (event_type, barber_id, barber_name, branch, title, body, emoji, metadata)
  VALUES (
    'achievement_unlock', p_barber_id, b_name, b_branch,
    b_name || ' mendapat: ' || p_label,
    'Rarity: ' || UPPER(p_rarity) || ' · +' || xp_reward || ' XP',
    (emoji_map ->> p_rarity)::TEXT,
    jsonb_build_object('badge_key', p_badge_key, 'rarity', p_rarity, 'xp', xp_reward)
  );

  RETURN true;
END;
$$;
