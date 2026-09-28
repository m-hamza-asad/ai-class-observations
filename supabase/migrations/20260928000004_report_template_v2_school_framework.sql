-- Report template v2: the school's fixed five-category observation framework.
-- v1 (generic, rubric derived per class) is deactivated but kept so nothing that referenced it breaks.
--
-- Editing without a deploy: insert a new version (copy this JSON, change it, set is_active = true
-- on the new row and false on the old one). Reports keep pointing at the version they were scored with.
--
-- "guidance" strings are working descriptors written from the category/criterion names. Criteria
-- marked "guidance_status": "needs_school_definition" use school-specific terms whose exact meaning
-- should be confirmed against the school's training documents.

update public.report_templates set is_active = false where is_active;

insert into public.report_templates (name, version, is_active, definition) values (
  'school-observation-framework', 2, true,
  $json$
  {
    "framework_name": "Classroom Observation Framework",
    "review_notice": "AI-generated draft. Scores and observations are suggestions produced from the recording and must be reviewed, edited if needed, and finalized by an administrator before they are used for any decision.",

    "rating_scale": [
      { "value": 1, "label": "Needs improvement", "description": "Expected practice is absent or ineffective." },
      { "value": 2, "label": "Developing",        "description": "Practice is present but inconsistent or only partly effective." },
      { "value": 3, "label": "Proficient",        "description": "Practice is consistently present and effective." },
      { "value": 4, "label": "Exemplary",         "description": "Practice is highly effective; a model for colleagues." }
    ],
    "not_observed_label": "Not observed",

    "scoring": {
      "method": "Each criterion is rated 1-4 or 'not observed'. A category's percentage is the mean of its observed ratings divided by 4. The overall framework percentage is the weighted mean of categories that have at least one observed criterion. Criteria that were not observed are excluded, never scored as zero, and are listed in the report.",
      "max_rating": 4
    },

    "categories": [
      {
        "key": "opening_routine",
        "title": "Opening Routine",
        "weight": 1,
        "criteria": [
          { "key": "greeting", "title": "Greeting", "observable_via": "audio+video",
            "guidance": "Teacher greets the class warmly at the start and students respond; sets a positive tone." },
          { "key": "punctuality", "title": "Punctuality", "observable_via": "video",
            "guidance": "Lesson starts promptly; little dead time at the beginning of the recording before instruction begins." },
          { "key": "grooming", "title": "Grooming / appearance", "observable_via": "video",
            "guidance": "Teacher's appearance is neat and professional as visible on camera. Rate only what is visible." },
          { "key": "cleanliness_check", "title": "Cleanliness check", "observable_via": "audio+video",
            "guidance": "Teacher checks or instructs that the classroom, desks and students' materials are clean and orderly at the start." },
          { "key": "flipped_learning", "title": "Flipped learning", "observable_via": "audio",
            "guidance_status": "needs_school_definition",
            "guidance": "Teacher draws on material students were asked to prepare before the lesson (e.g. asks what they read or learned at home) and builds the lesson from it." },
          { "key": "closed_book_introduction", "title": "Closed-book introduction", "observable_via": "audio+video",
            "guidance_status": "needs_school_definition",
            "guidance": "Topic is introduced with books closed (discussion, questions, prior knowledge) before students open their books." }
        ]
      },
      {
        "key": "oakian_methodology",
        "title": "Oakian Methodology",
        "weight": 1,
        "criteria": [
          { "key": "model_reading", "title": "Model Reading (Step I)", "observable_via": "audio",
            "guidance": "Teacher reads the text aloud clearly with correct pronunciation, pace and expression as a model for students." },
          { "key": "reading_with_explanation", "title": "Reading with Explanation (Step II)", "observable_via": "audio",
            "guidance": "Teacher reads again, explaining meaning, vocabulary and concepts as they go; checks understanding." },
          { "key": "chain_reading", "title": "Chain Reading (Step III)", "observable_via": "audio",
            "guidance": "Students read aloud in turn (one after another) while others follow; teacher manages turns and corrects." },
          { "key": "reading_quality", "title": "Reading quality", "observable_via": "audio",
            "guidance": "Overall fluency, pronunciation and expression of reading by teacher and students; errors are corrected." },
          { "key": "focused_grid", "title": "Focused grid", "observable_via": "audio+video",
            "guidance_status": "needs_school_definition",
            "guidance": "Teacher deliberately involves students across all parts of the classroom (not only the front or a few volunteers), e.g. by selecting readers and responders around the room." },
          { "key": "teacher_spoken_english", "title": "Teacher's spoken English", "observable_via": "audio",
            "guidance": "Teacher uses clear, accurate English as the main medium of instruction; any Urdu is purposeful (e.g. clarifying a difficult concept)." },
          { "key": "student_spoken_english", "title": "Students' spoken English", "observable_via": "audio",
            "guidance": "Students are encouraged and expected to respond in English; teacher supports and models when they switch to Urdu." },
          { "key": "use_of_resources", "title": "Use of resources", "observable_via": "video",
            "guidance": "Effective use of board, textbook, visuals or other resources to support the lesson." },
          { "key": "homework_explanation", "title": "Homework explanation", "observable_via": "audio",
            "guidance": "Homework is assigned and explained clearly (what, how, when due), usually near the end." }
        ]
      },
      {
        "key": "written_work_monitoring",
        "title": "Written Work Monitoring",
        "weight": 1,
        "criteria": [
          { "key": "correction_reminders", "title": "Correction reminders", "observable_via": "audio",
            "guidance": "Teacher reminds students to complete corrections of previously marked work." },
          { "key": "handwriting_reminders", "title": "Handwriting reminders", "observable_via": "audio",
            "guidance": "Teacher reminds students about neat, legible handwriting and presentation." },
          { "key": "checking_corrections_first", "title": "Checking corrections first", "observable_via": "audio+video",
            "guidance": "Before new written work, teacher checks that earlier corrections have been done." },
          { "key": "independent_student_work", "title": "Independent student work", "observable_via": "audio+video",
            "guidance": "Students do written work independently while the teacher monitors and supports without doing the work for them." }
        ]
      },
      {
        "key": "classroom_control_time_management",
        "title": "Classroom Control & Time Management",
        "weight": 1,
        "criteria": [
          { "key": "discipline", "title": "Discipline", "observable_via": "audio+video",
            "guidance": "Clear expectations; disruptions are handled calmly and quickly without losing instructional time." },
          { "key": "time_management", "title": "Time management", "observable_via": "audio+video",
            "guidance": "Lesson phases are well paced; transitions are efficient; the lesson is completed within the period." },
          { "key": "student_attentiveness", "title": "Student attentiveness", "observable_via": "audio",
            "guidance": "Students appear attentive: responsive to questions, low off-task noise. The camera faces the teacher, so judge mainly from audio and interaction; say so." },
          { "key": "participation_and_questioning", "title": "Participation and questioning", "observable_via": "audio",
            "guidance": "Teacher asks a range of questions (including open-ended), involves many students, and uses answers to check understanding." }
        ]
      },
      {
        "key": "communication_interpersonal",
        "title": "Communication & Interpersonal Skills",
        "weight": 1,
        "criteria": [
          { "key": "supportive_attitude", "title": "Supportive attitude", "observable_via": "audio+video",
            "guidance": "Teacher encourages students, praises effort, and responds patiently to mistakes." },
          { "key": "respect", "title": "Respect", "observable_via": "audio",
            "guidance": "Interactions are respectful in both directions; no belittling language." },
          { "key": "student_engagement", "title": "Student engagement", "observable_via": "audio",
            "guidance": "Students are actively involved (answering, reading, discussing) rather than passively listening." },
          { "key": "positive_learning_environment", "title": "Positive learning environment", "observable_via": "audio+video",
            "guidance": "The classroom climate feels safe and positive; students are comfortable participating." }
        ]
      }
    ],

    "lesson_plan_alignment": {
      "school_prompt": "Analyze this classroom teaching video and compare it with the attached lesson plan. Evaluate instructional delivery, pacing, questioning, student engagement, classroom management, assessment techniques, and achievement of learning objectives. Provide a detailed report with evidence from the transcript and a percentage alignment score.",
      "dimensions": [
        { "key": "instructional_delivery", "title": "Instructional delivery" },
        { "key": "pacing", "title": "Pacing" },
        { "key": "questioning", "title": "Questioning" },
        { "key": "student_engagement", "title": "Student engagement" },
        { "key": "classroom_management", "title": "Classroom management" },
        { "key": "assessment_techniques", "title": "Assessment techniques" },
        { "key": "learning_objectives", "title": "Achievement of learning objectives" }
      ],
      "requires": "A lesson planner attached to the recording. Without one, alignment is reported as not assessed rather than guessed."
    },

    "sections": [
      { "key": "overview", "title": "Lesson overview", "kind": "narrative",
        "guidance": "3-5 sentences: topic, structure of the lesson with approximate timestamps, overall impression. Neutral, professional tone." },
      { "key": "framework", "title": "Observation framework", "kind": "framework_categories" },
      { "key": "lesson_plan_alignment", "title": "Lesson plan alignment", "kind": "alignment" },
      { "key": "strengths", "title": "Key strengths", "kind": "bullets",
        "guidance": "3 bullets, each tied to a timestamp." },
      { "key": "recommendations", "title": "Recommendations", "kind": "bullets",
        "guidance": "3 prioritised, specific next steps, each linked to a framework category." },
      { "key": "evidence_limits", "title": "Evidence limitations", "kind": "narrative",
        "guidance": "What the recording could not show (camera faces the teacher; unclear audio share; gaps). Keeps the draft honest about its confidence." }
    ]
  }
  $json$::jsonb
);
