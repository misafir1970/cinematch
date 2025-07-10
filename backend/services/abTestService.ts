import { EventEmitter } from 'events';

interface ABTest {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  variants: ABTestVariant[];
  targetAudience: {
    percentage: number;
    criteria: AudienceCriteria;
  };
  metrics: string[];
  startDate: Date;
  endDate?: Date;
  createdBy: string;
  configuration: {
    trafficSplit: { [variantId: string]: number };
    minimumSampleSize: number;
    confidenceLevel: number;
    minimumDetectableEffect: number;
  };
}

interface ABTestVariant {
  id: string;
  name: string;
  description: string;
  allocation: number; // percentage 0-100
  configuration: any; // variant-specific config
}

interface AudienceCriteria {
  userTypes?: ('new' | 'existing' | 'premium')[];
  countries?: string[];
  platforms?: ('web' | 'mobile' | 'ios' | 'android')[];
  minRatingCount?: number;
  maxRatingCount?: number;
  demographics?: {
    ageRange?: { min: number; max: number };
    languages?: string[];
  };
}

interface ABTestResult {
  testId: string;
  variantId: string;
  userId: string;
  assignedAt: Date;
  isControlGroup: boolean;
}

interface TestMetrics {
  testId: string;
  variantId: string;
  totalUsers: number;
  conversions: number;
  conversionRate: number;
  confidence: number;
  statisticalSignificance: boolean;
  metrics: { [metricName: string]: number };
}

interface ExperimentEvent {
  testId: string;
  variantId: string;
  userId: string;
  eventType: string;
  eventData: any;
  timestamp: Date;
}

class ABTestService extends EventEmitter {
  private redis: any;
  private mongodb: any;
  private activeTests: Map<string, ABTest> = new Map();
  private userAssignments: Map<string, Map<string, string>> = new Map(); // userId -> testId -> variantId

  constructor(redis: any, mongodb: any) {
    super();
    this.redis = redis;
    this.mongodb = mongodb;
    this.loadActiveTests();
  }

  async createTest(test: Omit<ABTest, 'id'>): Promise<string> {
    try {
      const testId = this.generateTestId();
      const newTest: ABTest = {
        ...test,
        id: testId,
        status: 'draft'
      };

      // Validate test configuration
      this.validateTestConfiguration(newTest);

      // Save to database
      await this.mongodb.collection('ab_tests').insertOne(newTest);

      // Cache active test
      if (newTest.status === 'running') {
        this.activeTests.set(testId, newTest);
      }

      this.emit('test_created', { testId, test: newTest });
      return testId;

    } catch (error) {
      console.error('Error creating A/B test:', error);
      throw error;
    }
  }

  async startTest(testId: string): Promise<void> {
    try {
      const test = await this.getTest(testId);
      if (!test) {
        throw new Error(`Test ${testId} not found`);
      }

      if (test.status !== 'draft') {
        throw new Error(`Test ${testId} cannot be started from status ${test.status}`);
      }

      // Update test status
      test.status = 'running';
      test.startDate = new Date();

      // Save to database
      await this.mongodb.collection('ab_tests').updateOne(
        { id: testId },
        { $set: { status: 'running', startDate: test.startDate } }
      );

      // Add to active tests cache
      this.activeTests.set(testId, test);

      this.emit('test_started', { testId, test });

    } catch (error) {
      console.error(`Error starting test ${testId}:`, error);
      throw error;
    }
  }

  async assignUserToTest(userId: string, testId: string): Promise<string | null> {
    try {
      // Check if user is already assigned
      const existingAssignment = await this.getUserAssignment(userId, testId);
      if (existingAssignment) {
        return existingAssignment.variantId;
      }

      const test = this.activeTests.get(testId);
      if (!test || test.status !== 'running') {
        return null;
      }

      // Check if user meets audience criteria
      const meetsAudience = await this.checkAudienceCriteria(userId, test.targetAudience.criteria);
      if (!meetsAudience) {
        return null;
      }

      // Check traffic allocation
      const participates = Math.random() < (test.targetAudience.percentage / 100);
      if (!participates) {
        return null;
      }

      // Assign to variant using deterministic hash
      const variantId = this.assignToVariant(userId, testId, test.variants);
      
      // Save assignment
      const assignment: ABTestResult = {
        testId,
        variantId,
        userId,
        assignedAt: new Date(),
        isControlGroup: variantId === test.variants[0].id // First variant is usually control
      };

      await this.saveAssignment(assignment);

      // Cache assignment
      if (!this.userAssignments.has(userId)) {
        this.userAssignments.set(userId, new Map());
      }
      this.userAssignments.get(userId)!.set(testId, variantId);

      this.emit('user_assigned', assignment);
      return variantId;

    } catch (error) {
      console.error(`Error assigning user ${userId} to test ${testId}:`, error);
      return null;
    }
  }

  async getUserVariant(userId: string, testId: string): Promise<string | null> {
    try {
      // Check cache first
      const cachedAssignment = this.userAssignments.get(userId)?.get(testId);
      if (cachedAssignment) {
        return cachedAssignment;
      }

      // Check database
      const assignment = await this.getUserAssignment(userId, testId);
      if (assignment) {
        // Update cache
        if (!this.userAssignments.has(userId)) {
          this.userAssignments.set(userId, new Map());
        }
        this.userAssignments.get(userId)!.set(testId, assignment.variantId);
        return assignment.variantId;
      }

      // Assign user if not already assigned
      return await this.assignUserToTest(userId, testId);

    } catch (error) {
      console.error(`Error getting user variant for ${userId} in test ${testId}:`, error);
      return null;
    }
  }

  async trackEvent(event: Omit<ExperimentEvent, 'timestamp'>): Promise<void> {
    try {
      const experimentEvent: ExperimentEvent = {
        ...event,
        timestamp: new Date()
      };

      // Save event to database
      await this.mongodb.collection('ab_test_events').insertOne(experimentEvent);

      // Update Redis metrics
      await this.updateMetrics(experimentEvent);

      this.emit('event_tracked', experimentEvent);

    } catch (error) {
      console.error('Error tracking A/B test event:', error);
    }
  }

  async getTestResults(testId: string): Promise<TestMetrics[]> {
    try {
      const test = await this.getTest(testId);
      if (!test) {
        throw new Error(`Test ${testId} not found`);
      }

      const results: TestMetrics[] = [];

      for (const variant of test.variants) {
        const metrics = await this.calculateVariantMetrics(testId, variant.id);
        results.push(metrics);
      }

      return results;

    } catch (error) {
      console.error(`Error getting test results for ${testId}:`, error);
      throw error;
    }
  }

  async calculateStatisticalSignificance(testId: string, metricName: string): Promise<{
    isSignificant: boolean;
    pValue: number;
    confidence: number;
    recommendedAction: 'continue' | 'stop_winner' | 'stop_no_winner';
  }> {
    try {
      const results = await this.getTestResults(testId);
      if (results.length < 2) {
        return {
          isSignificant: false,
          pValue: 1,
          confidence: 0,
          recommendedAction: 'continue'
        };
      }

      // Simplified statistical significance calculation
      // In production, you'd use proper statistical tests (t-test, chi-square, etc.)
      const controlGroup = results[0];
      const treatmentGroup = results[1];

      const controlRate = controlGroup.conversionRate;
      const treatmentRate = treatmentGroup.conversionRate;
      
      // Sample size check
      const minSampleSize = 100; // Minimum for statistical power
      if (controlGroup.totalUsers < minSampleSize || treatmentGroup.totalUsers < minSampleSize) {
        return {
          isSignificant: false,
          pValue: 1,
          confidence: 0,
          recommendedAction: 'continue'
        };
      }

      // Calculate z-score (simplified)
      const pooledRate = (controlGroup.conversions + treatmentGroup.conversions) / 
                        (controlGroup.totalUsers + treatmentGroup.totalUsers);
      
      const se = Math.sqrt(pooledRate * (1 - pooledRate) * 
                          (1/controlGroup.totalUsers + 1/treatmentGroup.totalUsers));
      
      const zScore = Math.abs(treatmentRate - controlRate) / se;
      const pValue = 2 * (1 - this.normalCDF(Math.abs(zScore))); // Two-tailed test
      
      const isSignificant = pValue < 0.05; // 95% confidence
      const confidence = (1 - pValue) * 100;

      let recommendedAction: 'continue' | 'stop_winner' | 'stop_no_winner' = 'continue';
      if (isSignificant) {
        recommendedAction = treatmentRate > controlRate ? 'stop_winner' : 'stop_no_winner';
      }

      return {
        isSignificant,
        pValue,
        confidence,
        recommendedAction
      };

    } catch (error) {
      console.error(`Error calculating statistical significance for test ${testId}:`, error);
      throw error;
    }
  }

  private validateTestConfiguration(test: ABTest): void {
    // Validate traffic split adds up to 100%
    const totalAllocation = test.variants.reduce((sum, variant) => sum + variant.allocation, 0);
    if (Math.abs(totalAllocation - 100) > 0.01) {
      throw new Error('Variant allocations must sum to 100%');
    }

    // Validate audience percentage
    if (test.targetAudience.percentage < 0 || test.targetAudience.percentage > 100) {
      throw new Error('Target audience percentage must be between 0 and 100');
    }

    // Validate minimum sample size
    if (test.configuration.minimumSampleSize < 50) {
      throw new Error('Minimum sample size must be at least 50 per variant');
    }
  }

  private async checkAudienceCriteria(userId: string, criteria: AudienceCriteria): Promise<boolean> {
    try {
      // Get user profile from cache or database
      const userProfile = await this.getUserProfile(userId);
      if (!userProfile) {
        return false;
      }

      // Check user type
      if (criteria.userTypes && !criteria.userTypes.includes(userProfile.userType)) {
        return false;
      }

      // Check rating count
      if (criteria.minRatingCount && userProfile.ratingCount < criteria.minRatingCount) {
        return false;
      }
      if (criteria.maxRatingCount && userProfile.ratingCount > criteria.maxRatingCount) {
        return false;
      }

      // Check country
      if (criteria.countries && !criteria.countries.includes(userProfile.country)) {
        return false;
      }

      // Check platform
      if (criteria.platforms && !criteria.platforms.includes(userProfile.platform)) {
        return false;
      }

      return true;

    } catch (error) {
      console.error(`Error checking audience criteria for user ${userId}:`, error);
      return false;
    }
  }

  private assignToVariant(userId: string, testId: string, variants: ABTestVariant[]): string {
    // Use deterministic hash for consistent assignment
    const hash = this.hashString(`${userId}:${testId}`);
    const bucket = hash % 100;
    
    let cumulativeAllocation = 0;
    for (const variant of variants) {
      cumulativeAllocation += variant.allocation;
      if (bucket < cumulativeAllocation) {
        return variant.id;
      }
    }
    
    // Fallback to first variant
    return variants[0].id;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  private generateTestId(): string {
    return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async loadActiveTests(): Promise<void> {
    try {
      const activeTests = await this.mongodb.collection('ab_tests')
        .find({ status: 'running' })
        .toArray();
      
      activeTests.forEach(test => {
        this.activeTests.set(test.id, test);
      });

    } catch (error) {
      console.error('Error loading active tests:', error);
    }
  }

  private async getTest(testId: string): Promise<ABTest | null> {
    try {
      return await this.mongodb.collection('ab_tests').findOne({ id: testId });
    } catch (error) {
      console.error(`Error getting test ${testId}:`, error);
      return null;
    }
  }

  private async getUserAssignment(userId: string, testId: string): Promise<ABTestResult | null> {
    try {
      return await this.mongodb.collection('ab_test_assignments')
        .findOne({ userId, testId });
    } catch (error) {
      console.error(`Error getting user assignment for ${userId} in test ${testId}:`, error);
      return null;
    }
  }

  private async saveAssignment(assignment: ABTestResult): Promise<void> {
    try {
      await this.mongodb.collection('ab_test_assignments').insertOne(assignment);
    } catch (error) {
      console.error('Error saving assignment:', error);
    }
  }

  private async updateMetrics(event: ExperimentEvent): Promise<void> {
    try {
      const key = `ab_metrics:${event.testId}:${event.variantId}`;
      await this.redis.hincrby(key, event.eventType, 1);
      await this.redis.expire(key, 86400 * 30); // 30 days TTL
    } catch (error) {
      console.error('Error updating metrics:', error);
    }
  }

  private async calculateVariantMetrics(testId: string, variantId: string): Promise<TestMetrics> {
    try {
      // Get total users assigned to this variant
      const totalUsers = await this.mongodb.collection('ab_test_assignments')
        .countDocuments({ testId, variantId });

      // Get conversion events
      const conversions = await this.mongodb.collection('ab_test_events')
        .countDocuments({ 
          testId, 
          variantId, 
          eventType: 'conversion' 
        });

      const conversionRate = totalUsers > 0 ? (conversions / totalUsers) * 100 : 0;

      // Get other metrics from Redis
      const metricsKey = `ab_metrics:${testId}:${variantId}`;
      const redisMetrics = await this.redis.hgetall(metricsKey);
      
      const metrics: { [metricName: string]: number } = {};
      Object.entries(redisMetrics).forEach(([key, value]) => {
        metrics[key] = parseInt(value as string) || 0;
      });

      return {
        testId,
        variantId,
        totalUsers,
        conversions,
        conversionRate,
        confidence: 0, // Would be calculated based on statistical tests
        statisticalSignificance: false, // Would be calculated
        metrics
      };

    } catch (error) {
      console.error(`Error calculating metrics for variant ${variantId} in test ${testId}:`, error);
      throw error;
    }
  }

  private async getUserProfile(userId: string): Promise<any> {
    // This would integrate with your user service
    // Returning mock data for now
    return {
      userType: 'existing',
      ratingCount: 50,
      country: 'US',
      platform: 'web'
    };
  }

  // Cumulative distribution function for standard normal distribution
  private normalCDF(x: number): number {
    // Approximation using error function
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    
    if (x > 0) {
      prob = 1 - prob;
    }
    
    return prob;
  }
}

// Helper function for assignment based on user groups
export function assignUserToGroup(userId: string): 'A' | 'B' {
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return hash % 2 === 0 ? 'A' : 'B';
}

export { ABTestService, ABTest, ABTestVariant, ABTestResult, TestMetrics, ExperimentEvent };