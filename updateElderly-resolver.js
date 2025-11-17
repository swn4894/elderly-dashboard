import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { elderlyID, ...updates } = ctx.args.input;

  const expressionNames = {};
  const expressionValues = {};
  const updateExpressions = [];

  if (updates.name !== undefined) {
    updateExpressions.push('#name = :name');
    expressionNames['#name'] = 'name';
    expressionValues[':name'] = updates.name;
  }

  if (updates.deviceId !== undefined) {
    updateExpressions.push('deviceId = :deviceId');
    expressionValues[':deviceId'] = updates.deviceId;
  }

  if (updates.age !== undefined) {
    updateExpressions.push('age = :age');
    expressionValues[':age'] = updates.age;
  }

  if (updates.medicalNotes !== undefined) {
    updateExpressions.push('medicalNotes = :medicalNotes');
    expressionValues[':medicalNotes'] = updates.medicalNotes;
  }

  if (updates.caretakerID !== undefined) {
    updateExpressions.push('caretakerID = :caretakerID');
    expressionValues[':caretakerID'] = updates.caretakerID;
  }

  // Family member fields
  if (updates.familyMemberName !== undefined) {
    updateExpressions.push('familyMemberName = :familyMemberName');
    expressionValues[':familyMemberName'] = updates.familyMemberName;
  }

  if (updates.familyMemberRelationship !== undefined) {
    updateExpressions.push('familyMemberRelationship = :familyMemberRelationship');
    expressionValues[':familyMemberRelationship'] = updates.familyMemberRelationship;
  }

  if (updates.familyMemberEmail !== undefined) {
    updateExpressions.push('familyMemberEmail = :familyMemberEmail');
    expressionValues[':familyMemberEmail'] = updates.familyMemberEmail;
  }

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ elderlyID }),
    update: {
      expression: 'SET ' + updateExpressions.join(', '),
      expressionNames: Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
      expressionValues: util.dynamodb.toMapValues(expressionValues),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
