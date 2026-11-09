CREATE TABLE sharepass_code_policy (
 owner TEXT NOT NULL,
 event TEXT NOT NULL,
 theme TEXT CHECK(theme IS NULL OR length(theme)<=160),
 overrides TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(overrides) AND json_type(overrides)='object'),
 PRIMARY KEY(owner,event)
);
