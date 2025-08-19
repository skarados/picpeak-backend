const { db } = require('../../src/database/db');

async function up() {
  console.log('Adding gallery feedback tables...');
  
  // Create event_feedback_settings table
  const hasEventFeedbackSettingsTable = await db.schema.hasTable('event_feedback_settings');
  if (!hasEventFeedbackSettingsTable) {
    await db.schema.createTable('event_feedback_settings', (table) => {
      table.increments('id').primary();
      table.integer('event_id').references('id').inTable('events').onDelete('CASCADE');
      table.boolean('feedback_enabled').defaultTo(true);
      table.boolean('allow_ratings').defaultTo(true);
      table.boolean('allow_likes').defaultTo(true);
      table.boolean('allow_comments').defaultTo(false);
      table.boolean('allow_favorites').defaultTo(true);
      table.boolean('require_name_email').defaultTo(false);
      table.boolean('moderate_comments').defaultTo(true);
      table.boolean('show_feedback_to_guests').defaultTo(true);
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
      table.unique(['event_id']);
    });
  }

  // Create photo_feedback table
  const hasPhotoFeedbackTable = await db.schema.hasTable('photo_feedback');
  if (!hasPhotoFeedbackTable) {
    await db.schema.createTable('photo_feedback', (table) => {
      table.increments('id').primary();
      table.integer('photo_id').references('id').inTable('photos').onDelete('CASCADE');
      table.integer('event_id').references('id').inTable('events').onDelete('CASCADE');
      table.string('feedback_type', 20).notNullable();
      table.integer('rating');
      table.text('comment_text');
      table.string('guest_name', 100);
      table.string('guest_email', 255);
      table.string('guest_identifier', 64);
      table.string('ip_address', 45);
      table.text('user_agent');
      table.boolean('is_approved').defaultTo(true);
      table.boolean('is_hidden').defaultTo(false);
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
      
      // Add indexes
      table.index(['photo_id']);
      table.index(['event_id']);
      table.index(['feedback_type']);
      table.index(['guest_identifier']);
      
      // Add check constraint for rating (PostgreSQL)
      if (db.client.config.client === 'pg') {
        table.check('?? >= 1 AND ?? <= 5', ['rating', 'rating']);
      }
    });
  }

  // Create feedback_rate_limits table
  const hasFeedbackRateLimitsTable = await db.schema.hasTable('feedback_rate_limits');
  if (!hasFeedbackRateLimitsTable) {
    await db.schema.createTable('feedback_rate_limits', (table) => {
      table.increments('id').primary();
      table.string('identifier', 64).notNullable();
      table.integer('event_id').references('id').inTable('events').onDelete('CASCADE');
      table.string('action_type', 20).notNullable();
      table.integer('action_count').defaultTo(1);
      table.timestamp('window_start').defaultTo(db.fn.now());
      
      // Add indexes
      table.index(['identifier', 'event_id', 'action_type']);
      table.index(['window_start']);
    });
  }

  // Create feedback_word_filters table
  const hasFeedbackWordFiltersTable = await db.schema.hasTable('feedback_word_filters');
  if (!hasFeedbackWordFiltersTable) {
    await db.schema.createTable('feedback_word_filters', (table) => {
      table.increments('id').primary();
      table.string('word', 100).notNullable();
      table.string('severity', 20).defaultTo('moderate');
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.unique(['word']);
    });
  }

  // Add feedback summary columns to photos table
  const hasPhotosFeedbackColumn = await db.schema.hasColumn('photos', 'feedback_count');
  if (!hasPhotosFeedbackColumn) {
    await db.schema.alterTable('photos', (table) => {
      table.integer('feedback_count').defaultTo(0);
      table.integer('like_count').defaultTo(0);
      table.decimal('average_rating', 3, 2).defaultTo(0);
      table.integer('favorite_count').defaultTo(0);
    });
  }

  // Add feedback notification settings to app_settings
  const feedbackSettings = [
    {
      setting_key: 'feedback_notification_email',
      setting_value: JSON.stringify(''),
      setting_type: 'feedback'
    },
    {
      setting_key: 'feedback_rate_limits',
      setting_value: JSON.stringify({
        rating: { max: 100, window: 3600 }, // 100 ratings per hour
        comment: { max: 20, window: 3600 }, // 20 comments per hour
        like: { max: 200, window: 3600 } // 200 likes per hour
      }),
      setting_type: 'feedback'
    }
  ];

  // Insert feedback settings if they don't exist
  for (const setting of feedbackSettings) {
    const exists = await db('app_settings')
      .where('setting_key', setting.setting_key)
      .first();
    
    if (!exists) {
      await db('app_settings').insert(setting);
    }
  }
  
  console.log('Gallery feedback tables created successfully');
};

async function down() {
  console.log('Removing gallery feedback tables...');
  
  // Remove feedback settings from app_settings
  await db('app_settings')
    .where('setting_type', 'feedback')
    .delete();

  // Remove feedback columns from photos table
  await db.schema.alterTable('photos', (table) => {
    table.dropColumn('feedback_count');
    table.dropColumn('like_count');
    table.dropColumn('average_rating');
    table.dropColumn('favorite_count');
  });

  // Drop tables in reverse order
  await db.schema.dropTableIfExists('feedback_word_filters');
  await db.schema.dropTableIfExists('feedback_rate_limits');
  await db.schema.dropTableIfExists('photo_feedback');
  await db.schema.dropTableIfExists('event_feedback_settings');
  
  console.log('Gallery feedback tables removed');
};

module.exports = { up, down };